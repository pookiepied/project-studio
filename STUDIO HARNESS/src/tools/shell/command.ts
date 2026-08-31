import { basename } from "node:path";

import { ToolError } from "../errors.js";

/**
 * Reading a command line to answer one permission question: which programs
 * does this run?
 *
 * A command line can name several programs - `npm test && curl … | jq .` runs
 * three - and `shell:npm` must not quietly cover the other two. So the
 * resource is no longer "the program the model named"; it is every program
 * this line starts, and each one is authorized on its own.
 *
 * This reader is deliberately simpler than any of the interpreters it reads
 * for, and it refuses rather than guesses. A guessed program name is worse
 * than a refusal: the refusal asks a person, the guess executes one. What it
 * cannot see, it says so and stops:
 *
 * - **Command substitution.** `$(…)`, backticks, and PowerShell's `$( )`
 *   subexpressions run whatever they evaluate to. In bash a backtick is
 *   substitution; in PowerShell it is an escape character. This reader is
 *   interpreter-agnostic on purpose, so a backtick is refused in both - an
 *   over-refusal in PowerShell, and the honest trade.
 * - **Process substitution and heredocs.** `<(…)`, `>(…)`, `<<EOF`. The body
 *   of a heredoc is data this reader would otherwise read as commands.
 * - **A variable or alias as the program.** `$CMD build`, `%TOOL% run`: the
 *   program is whatever the variable holds, and nobody can approve a name
 *   that is not there. A variable in an *argument* position is fine - the
 *   program it belongs to is still checked.
 * - **An unterminated quote.** Where quoting ends, so does the reader's
 *   idea of where arguments stop.
 * - **Control flow.** Bash's `if`/`for`/`while` bodies and PowerShell's
 *   statements are not a flat list of programs. A line that is a bare
 *   reserved word with a body after it is refused.
 *
 * What it sees and does not refuse: redirection (`>`, `2>&1` and friends do
 * not name a program; the interpreter and the sandbox own where files land),
 * environment assignments before a command (`FOO=1 npm test`), PowerShell's
 * call operator (`& "C:\Program Files\x.exe"`), and reserved words standing
 * where a program would (`then npm test` checks `npm`). A construct whose
 * body opens with anything but a program - `if [ -f x ]; then …`, where the
 * test bracket is not a program either - is refused, not half-read.
 */

/** Extensions Windows treats as programs that are really scripts for a shell. */
const SCRIPT_EXTENSIONS = [".exe", ".com", ".cmd", ".bat", ".ps1"] as const;

/**
 * Words that open a shell construct rather than name a program.
 *
 * Bash only - a command is split into flat segments first, so these appear at
 * the head of a segment when control flow carries a command after them.
 * Skipped when hunting the program, never treated as one: `then npm test`
 * runs `npm`, and a permission resource named `shell:then` would be a lie
 * with a dialog attached.
 */
const RESERVED_WORDS = new Set([
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "for",
  "while",
  "until",
  "do",
  "done",
  "case",
  "esac",
  "in",
  "time",
  "!",
  "{",
  "}",
]);

/** Characters that end one command and start another, outside quotes. */
function isOperator(character: string, next: string | undefined, current: string): boolean {
  if (character === "|" || character === ";" || character === "(" || character === ")") {
    return true;
  }
  if (character === "\n" || character === "\r") return true;
  // `&` on its own (cmd and bash background) and the head of `&&`. The pair is
  // handled by consuming two characters at the call site; a lone `&` separates.
  // Not a separator when it is redirect glue: `2>&1` is one token, so `&` with
  // a `>` behind it (`&>`) or in front of it (`2>&`) stays inside the token for
  // the redirect check to see.
  if (character !== "&") return false;
  if (next === "&" || next === ">") return false;
  return !current.endsWith(">");
}

/** True for a token that redirects output or input rather than naming a program. */
function isRedirect(token: string): boolean {
  // `&>` and `&>>` (bash, both streams at once) start with `&`, which is why
  // the class admits it; a bare `&` never reaches here, because it is consumed
  // as an operator while the line is split.
  return /^[0-9&]*[<>]/.test(token) && token !== "<(" && token !== ">(";
}

/**
 * Programs that run another program, and are therefore not the program.
 *
 * `env FOO=1 node build.js` runs `node`. Approving `shell:env` and calling
 * that the decision would be a lie with a dialog attached: the name the user
 * agreed to is not the name that executes. So these are stepped through to
 * the program they carry, exactly as a path prefix is stripped, and the
 * question the user is asked names what actually runs.
 *
 * Only wrappers that take no options of their own are here, because a wrapper
 * that does - `timeout 30 node x`, `nice -n 5 node x` - hides its program
 * behind an argument this reader would have to know the shape of, and
 * guessing which token is the program is the thing this file exists not to
 * do. `xargs` builds its command from input it has not read yet, `sudo` is
 * not ours to reason about, and `find -exec` buries the command mid-list.
 * Those remain the wider approval-granularity question that this does not
 * claim to close; they are still refused or still named as themselves, never
 * silently stepped through.
 */
const COMMAND_WRAPPERS = new Set(["env", "nohup"]);

/** An environment assignment prefix, POSIX (`FOO=1`) or PowerShell (`$env:FOO=`). */
function isAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token) || /^\$env:[A-Za-z0-9_]+=/.test(token);
}

/**
 * The permission name a program token carries.
 *
 * A path is reduced to its last component and a script extension is stripped,
 * so `node.exe`, `npm.cmd`, and `C:\tools\gen.ps1` become `node`, `npm`, and
 * `gen`. The same tool spelled three ways is one decision for a person to
 * make, not three.
 */
export function programName(token: string): string {
  const withoutQuotes = token.replace(/^["']|["']$/g, "");
  const base = basename(withoutQuotes.replace(/\\/g, "/"));
  const lowered = base.toLowerCase();
  const extension = SCRIPT_EXTENSIONS.find((candidate) => lowered.endsWith(candidate));
  const stripped = extension === undefined ? base : base.slice(0, -extension.length);
  return stripped === "" ? base : stripped;
}

interface Segment {
  readonly tokens: readonly string[];
  /** A PowerShell call operator was consumed at the head of this segment. */
  readonly callOperator: boolean;
}

/**
 * Splits the command line into segments at operators, with quotes grouped.
 *
 * Quoting rules are the intersection of the three interpreters: double quotes
 * group everywhere, single quotes group in bash and PowerShell (and are data
 * in cmd, which this reader accepts as a cost of being interpreter-agnostic -
 * a cmd line with an apostrophe in an argument is refused rather than
 * misparsed). An escape inside double quotes never closes the quote, which is
 * true in bash and close enough in PowerShell to keep the grouping honest.
 */
function segmentsOf(command: string): readonly Segment[] {
  const segments: Segment[] = [];
  let tokens: string[] = [];
  let current = "";
  let inDouble = false;
  let inSingle = false;
  let callOperator = false;

  const endSegment = (): void => {
    if (current !== "") tokens.push(current);
    current = "";
    // An empty segment is pushed too, not skipped: `a && ; b` hides a command
    // slot with nothing in it, and the caller refuses that rather than letting
    // it mean "a, then b". The one empty segment that never materialises is
    // the trailing one - `a &&` at end of line is the interpreter's syntax
    // error to make, and nothing here was skipped past.
    segments.push({ tokens, callOperator });
    tokens = [];
    callOperator = false;
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (character === undefined) break;
    const next = command[index + 1];

    if (inDouble) {
      if (character === "\\" && next === '"') {
        current += '"';
        index += 1;
        continue;
      }
      if (character === '"') {
        inDouble = false;
        continue;
      }
      current += character;
      continue;
    }
    if (inSingle) {
      if (character === "'") {
        inSingle = false;
        continue;
      }
      current += character;
      continue;
    }

    if (character === '"') {
      inDouble = true;
      continue;
    }
    if (character === "'") {
      inSingle = true;
      continue;
    }
    if (character === "\\" && next === "\n") {
      // A bash line continuation. The two halves are one command, so the
      // newline is removed rather than treated as a separator.
      index += 1;
      continue;
    }
    if (character === "^" && next === "\n") {
      // cmd's continuation, treated the same way.
      index += 1;
      continue;
    }
    if (character === " " || character === "\t") {
      if (current !== "") tokens.push(current);
      current = "";
      continue;
    }
    if (character === "&" && next === "&") {
      endSegment();
      index += 1;
      continue;
    }
    if (character === "|" && next === "|") {
      endSegment();
      index += 1;
      continue;
    }
    if (isOperator(character, next, current)) {
      if (character === "&" && current === "" && tokens.length === 0 && !callOperator) {
        // A leading `&` is PowerShell's call operator, not a separator: the
        // segment it opens names the program to run.
        callOperator = true;
        continue;
      }
      endSegment();
      continue;
    }
    current += character;
  }

  if (inDouble || inSingle) {
    throw new ToolError("invalid_input", {
      message:
        "This command has an unterminated quote, so there is no reading it " +
        "reliably. It was not run.",
    });
  }
  if (current !== "") tokens.push(current);
  if (tokens.length > 0 || callOperator) {
    segments.push({ tokens, callOperator });
  }
  return segments;
}

/**
 * Every program a command line starts, in the order the line names them.
 *
 * Throws a {@link ToolError} rather than returning a partial answer: the
 * caller either gets the full list to authorize, or a refusal naming what the
 * reader could not see.
 */
export function readCommandPrograms(command: string): readonly string[] {
  if (command.includes("\0")) {
    throw new ToolError("invalid_input", {
      message: "A command may not contain a null character.",
    });
  }
  // Substitution and process substitution are refused wherever they appear,
  // including inside an argument: what reaches the interpreter is a command
  // line, and the program that `$(…)` would run is never one we checked.
  if (/`|\$\(|<\(|>\(|<</.test(command)) {
    // The refusal says what to do instead, because a bare "no" is a wasted
    // turn: models reach for `$(...)` and heredocs constantly, and one that is
    // only told no tries the same shape again. Naming the two replacements -
    // separate commands, and the write tool for file bodies - turns a dead end
    // into the next call.
    throw new ToolError("invalid_input", {
      message:
        "This command uses command substitution, a heredoc, or process " +
        "substitution, and the programs it would run cannot be read from it, " +
        "so there is nothing to approve. Run the steps as separate commands " +
        "and use the result of one in the next, and write file contents with " +
        "the write tool rather than a heredoc.",
    });
  }

  const names: string[] = [];
  for (const segment of segmentsOf(command)) {
    const tokens = [...segment.tokens];

    let program: string | undefined;
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token === undefined) break;
      if (isRedirect(token)) {
        // The next token is the redirect's target - a file or `/dev/null`,
        // not a program - unless the target was written glued to the
        // operator, in which case this token already carried it.
        const glued = /^[0-9&]*[<>]{1,2}\S/.test(token) || /^[0-9]*>&\S/.test(token);
        if (!glued) index += 1;
        continue;
      }
      if (isAssignment(token)) continue;
      if (RESERVED_WORDS.has(token)) continue;
      if (token.startsWith("-")) {
        throw new ToolError("invalid_input", {
          message:
            `"${token}" opens a command in this line but is an option, not a ` +
            "program, so there is nothing to approve. The command was not run.",
        });
      }
      if (token.startsWith("$") || token.startsWith("%")) {
        throw new ToolError("invalid_input", {
          message:
            `This line runs a program named by the variable ${token}, and the ` +
            "program it holds cannot be approved in advance. Name the program " +
            "directly.",
        });
      }
      if (COMMAND_WRAPPERS.has(programName(token))) {
        // A wrapper is not the program. Keep reading: the next plain token in
        // this segment is what actually runs, and that is the name the user
        // will be asked about. The wrapper itself is not recorded - approving
        // `env` means nothing, and asking twice for one execution is a worse
        // question, not a safer one.
        continue;
      }
      program = token;
      break;
    }

    if (program === undefined) {
      if (segment.callOperator && tokens.length === 0) {
        throw new ToolError("invalid_input", {
          message:
            "This line ends with a call operator and no program after it. " +
            "The command was not run.",
        });
      }
      throw new ToolError("invalid_input", {
        message:
          "Part of this command names no program - an operator with nothing " +
          "runnable on one side of it - so there is nothing to approve. " +
          "The command was not run.",
      });
    }

    const name = programName(program);
    if (name === "") {
      throw new ToolError("invalid_input", {
        message: "A command in this line names an empty program. The command was not run.",
      });
    }
    names.push(name);
  }

  if (names.length === 0) {
    throw new ToolError("invalid_input", {
      message: "A command is required.",
    });
  }
  return names;
}

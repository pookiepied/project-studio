import { basename } from "node:path";

import type { CommandSeparator, Interpreter } from "../../process/interpreter.js";
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
 *
 * **Which separators split a line is a property of the interpreter, not of
 * this reader**, so the interpreter is an argument rather than an assumption.
 * Reading the union of every shell's separators was wrong in both directions
 * at once. On `cmd.exe`, `git status; git push` is *one* command - cmd passes
 * the semicolon through as an argument - so the reader named two programs,
 * asked the user to approve `git` twice, and the second one never ran. On
 * Windows PowerShell 5.1, `npm test && npm run build` is not a chain at all;
 * 5.1 has no `&&`, and the line is a syntax error the user was asked to
 * approve first. Approving a program that does not run teaches nothing, and
 * the reverse of it - a separator honoured but not split on - would run a
 * program nobody was asked about.
 *
 * A separator the current interpreter does not honour is refused at parse
 * time rather than folded into the token beside it. Folding is the guess
 * again: a `;` inside a cmd line may be an argument the user meant, or a
 * chain the model wrote for a shell it does not have, and the two are not
 * distinguishable from here. The refusal names the interpreter and what to
 * write instead, which is a turn the model can act on. A separator inside
 * quotes is content and is never examined - quoting is resolved before any
 * separator branch is reached.
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

/**
 * Characters that end one command and start another in every interpreter this
 * reader reads for, so no interpreter has to be consulted about them.
 *
 * A pipe chains in bash, cmd and both PowerShells alike; parentheses group a
 * subshell or a scriptblock, and either way what follows is a command slot;
 * a newline ends a statement everywhere. `;`, `&`, `&&` and `||` are *not*
 * here, because those are exactly the ones the interpreters disagree about.
 */
function isUniversalOperator(character: string): boolean {
  return (
    character === "|" ||
    character === "(" ||
    character === ")" ||
    character === "\n" ||
    character === "\r"
  );
}

/**
 * Refuses a line whose separator this machine's interpreter will not honour.
 *
 * Names the interpreter, because the model did not choose it and cannot see
 * it from the line it wrote, and names the separator that does work, because
 * a refusal that does not say what to write instead buys another attempt at
 * the same shape.
 */
function refuseSeparator(separator: CommandSeparator, interpreter: Interpreter): never {
  const honoured = interpreter.separators.filter((candidate) => candidate !== "&");
  const alternative =
    honoured.length === 0
      ? "Run each command in its own call."
      : `Chain with ${honoured.join(" or ")}, or run each command in its own call.`;
  throw new ToolError("invalid_input", {
    message:
      `This line separates commands with "${separator}", which ${interpreter.label} ` +
      `does not honour, so it would not run as written and there is nothing ` +
      `to approve. ${alternative}`,
  });
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

/** PowerShell and pwsh, which share a variable syntax the others do not have. */
function isPowerShellFamily(interpreter: Interpreter): boolean {
  return interpreter.kind === "pwsh" || interpreter.kind === "powershell";
}

/**
 * A PowerShell variable name, as the head of an assignment.
 *
 * `$ProgressPreference`, `$env:PATH`, `$script:count`. Not `$(`, which is
 * substitution and is refused long before this, and not a bare `$`.
 */
function isVariableToken(token: string): boolean {
  return /^\$[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)?$/.test(token);
}

/**
 * A token that is a value rather than a program: a quoted string or a number.
 *
 * Only consulted just after an assignment's `=`, where PowerShell itself makes
 * the distinction. `$x = 'quiet'` stores a string and runs nothing; `$x =
 * Get-Date` runs `Get-Date` and stores what it returned. The reader has to
 * make the same split, because refusing the first would refuse an assignment
 * and naming the second's program is the whole job.
 */
function isLiteralValue(token: string, wasQuoted: boolean): boolean {
  return wasQuoted || /^-?[0-9]/.test(token) || /^\$(true|false|null)$/i.test(token);
}

/**
 * The permission name a program token carries.
 *
 * A path is reduced to its last component and a script extension is stripped,
 * so `node.exe`, `npm.cmd`, and `C:\tools\gen.ps1` become `node`, `npm`, and
 * `gen`. The same tool spelled three ways is one decision for a person to
 * make, not three.
 */
function programName(token: string): string {
  const withoutQuotes = token.replace(/^["']|["']$/g, "");
  const base = basename(withoutQuotes.replace(/\\/g, "/"));
  const lowered = base.toLowerCase();
  const extension = SCRIPT_EXTENSIONS.find((candidate) => lowered.endsWith(candidate));
  const stripped = extension === undefined ? base : base.slice(0, -extension.length);
  return stripped === "" ? base : stripped;
}

interface Segment {
  readonly tokens: readonly string[];
  /**
   * Whether each token had a quote in it, positionally.
   *
   * Quotes are consumed while tokenizing, so by the time a token is examined
   * `'SilentlyContinue'` and `Get-Date` look the same. That difference is
   * usually irrelevant - a quoted program name is still a program name, which
   * is why `"C:\Program Files\tool.exe"` works - but on the right of a
   * PowerShell assignment it is the whole question: a quoted value is a
   * string being stored, and a bare word is a command being run.
   */
  readonly quoted: readonly boolean[];
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
function segmentsOf(command: string, interpreter: Interpreter): readonly Segment[] {
  const honours = (separator: CommandSeparator): boolean =>
    interpreter.separators.includes(separator);

  const segments: Segment[] = [];
  let tokens: string[] = [];
  let quoted: boolean[] = [];
  let current = "";
  let currentQuoted = false;
  let inDouble = false;
  let inSingle = false;
  let callOperator = false;

  const endToken = (): void => {
    if (current === "") return;
    tokens.push(current);
    quoted.push(currentQuoted);
    current = "";
    currentQuoted = false;
  };

  const endSegment = (): void => {
    endToken();
    // An empty segment is pushed too, not skipped: `a && ; b` hides a command
    // slot with nothing in it, and the caller refuses that rather than letting
    // it mean "a, then b". The one empty segment that never materialises is
    // the trailing one - `a &&` at end of line is the interpreter's syntax
    // error to make, and nothing here was skipped past.
    segments.push({ tokens, quoted, callOperator });
    tokens = [];
    quoted = [];
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
      currentQuoted = true;
      continue;
    }
    if (character === "'") {
      inSingle = true;
      currentQuoted = true;
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
      endToken();
      continue;
    }
    if (character === "&" && next === "&") {
      if (!honours("&&")) refuseSeparator("&&", interpreter);
      endSegment();
      index += 1;
      continue;
    }
    if (character === "|" && next === "|") {
      if (!honours("||")) refuseSeparator("||", interpreter);
      endSegment();
      index += 1;
      continue;
    }
    if (isUniversalOperator(character)) {
      endSegment();
      continue;
    }
    if (character === ";") {
      if (!honours(";")) refuseSeparator(";", interpreter);
      endSegment();
      continue;
    }
    if (character === "&") {
      // Redirect glue before anything else: `2>&1` and `&>log` are one token,
      // so a `&` with a `>` on either side stays in the token for the redirect
      // check to see, whatever the interpreter honours.
      if (next === ">" || current.endsWith(">")) {
        current += character;
        continue;
      }
      if (current === "" && tokens.length === 0 && !callOperator) {
        // A leading `&` is PowerShell's call operator, not a separator: the
        // segment it opens names the program to run. Checked before the
        // interpreter is consulted, because the interpreter that uses `&` this
        // way - Windows PowerShell 5.1 - is exactly the one that does not
        // honour it as a separator, and consulting first would refuse the
        // only syntax 5.1 has for running a quoted absolute path.
        callOperator = true;
        continue;
      }
      if (!honours("&")) refuseSeparator("&", interpreter);
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
  endToken();
  if (tokens.length > 0 || callOperator) {
    segments.push({ tokens, quoted, callOperator });
  }
  return segments;
}

/**
 * Every program a command line starts, in the order the line names them.
 *
 * Throws a {@link ToolError} rather than returning a partial answer: the
 * caller either gets the full list to authorize, or a refusal naming what the
 * reader could not see.
 *
 * The interpreter is required rather than defaulted, because a default is a
 * silent assumption about which separators split the line, and being wrong
 * about that is how a program gets approved under a name that never runs.
 */
export function readCommandPrograms(
  command: string,
  interpreter: Interpreter,
): readonly string[] {
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
  for (const segment of segmentsOf(command, interpreter)) {
    const tokens = [...segment.tokens];

    let program: string | undefined;
    /**
     * Set when the segment is an assignment that stores a value.
     *
     * Such a segment legitimately runs nothing - `$count = 5` is a whole,
     * legal statement - so it must not fall into the "names no program"
     * refusal below, which exists for an operator with an empty slot beside
     * it. The two look identical by the time the loop ends, hence the flag.
     */
    let storesValue = false;
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
      // PowerShell writes an assignment as three tokens - `$name`, `=`, and
      // the value - so the shape the other branch matches never appears, and
      // the variable branch below read the head of one as a program to run.
      // An evaluation session hit exactly this: `$ProgressPreference =
      // 'SilentlyContinue'; Expand-Archive ...` was refused with "this line
      // runs a program named by the variable $ProgressPreference", which is
      // not what that line does. Nothing was named by the variable; the
      // variable was being written to.
      //
      // The two tokens are stepped over rather than the segment skipped,
      // because what follows an `=` may well be a command: `$x = Get-Date`
      // runs `Get-Date` and stores the result, and that program still has to
      // be named. Only a literal ends the segment with no program in it.
      if (
        isPowerShellFamily(interpreter) &&
        isVariableToken(token) &&
        tokens[index + 1] === "="
      ) {
        const value = tokens[index + 2];
        if (value === undefined || isLiteralValue(value, segment.quoted[index + 2] === true)) {
          storesValue = true;
          break;
        }
        index += 1;
        continue;
      }
      if (RESERVED_WORDS.has(token)) continue;
      // An option prefix is per interpreter, and getting it wrong is not
      // cosmetic. `cmd` writes switches as `/d`, and a reader that only knew
      // `-` took `for /d %d in (*) do echo %d` and answered with the programs
      // `d`, `*` and `echo`: a switch, a wildcard, and the only real name in
      // the line. It did not refuse - it asked a person to approve `shell:d`
      // and `shell:*` for a command that runs none of them.
      //
      // `/` cannot open a program on cmd: a Windows path starts with a drive
      // letter or a UNC prefix. On POSIX it always can - `/usr/bin/node` - so
      // this is asked of the interpreter rather than applied everywhere, the
      // same way separators are.
      const optionPrefix = interpreter.kind === "cmd" ? /^[-/]/ : /^-/;
      if (optionPrefix.test(token)) {
        throw new ToolError("invalid_input", {
          message:
            `"${token}" opens a command in this line but is an option, not a ` +
            "program, so there is nothing to approve. The command was not run.",
        });
      }

      // A wildcard is a set of filenames, not a program. Reaching here means
      // the line put one where a program goes, which on cmd is what the body
      // of a `for` looks like after this reader has split on its parentheses.
      // Refused rather than named, because `shell:*` is a permission resource
      // whose name is a wildcard - a grant nobody would knowingly write, and
      // one that reads as "everything" to anything that ever globs.
      if (token.includes("*") || token.includes("?")) {
        throw new ToolError("invalid_input", {
          message:
            `"${token}" opens a command in this line but is a filename ` +
            "pattern, not a program, so there is nothing to approve. Name " +
            "the program directly. The command was not run.",
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
      if (storesValue) continue;
      if (segment.callOperator && tokens.length === 0) {
        throw new ToolError("invalid_input", {
          message:
            "This line ends with a call operator and no program after it. " +
            "The command was not run.",
        });
      }
      // Parentheses are named when the line has them, because that is very
      // nearly always the reason a segment came out empty, and the generic
      // sentence sent a reader looking for a missing program instead.
      //
      // The reader splits on `(` and `)` in every interpreter - they open a
      // subshell in bash and a block in PowerShell, and either way what
      // follows is a command slot. In cmd they are neither: `for /d %d in (*)
      // do ...` is one builtin, and splitting it produces slots with nothing
      // runnable in them. The whole construct is then refused, which is safe
      // and correct - we cannot read what it runs - but a refusal that does
      // not say which character caused it reads as a bug in the tool.
      //
      // This is the message, not the fix. Reading cmd's grouping constructs is
      // its own task; naming the cause is what lets a model write the command
      // another way in the meantime.
      const grouped = command.includes("(") || command.includes(")");
      throw new ToolError("invalid_input", {
        message: grouped
          ? "This line uses parentheses, which are read as grouping that " +
            "starts a new command, and one of the parts they make names no " +
            "program - so there is nothing to approve and the command was " +
            "not run. A shell builtin that takes a parenthesised body, such " +
            "as cmd's for loop, cannot be read this way. Write it without " +
            "parentheses, or put it in a script file and run that."
          : "Part of this command names no program - an operator with " +
            "nothing runnable on one side of it - so there is nothing to " +
            "approve. The command was not run.",
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

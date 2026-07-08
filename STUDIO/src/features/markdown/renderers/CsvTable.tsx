import { useMemo } from "react";

interface CsvTableProps {
  code: string;
}

function parseCsv(raw: string): string[][] {
  return raw
    .trim()
    .split("\n")
    .map((line) => {
      const row: string[] = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          inQuotes = !inQuotes;
        } else if (ch === "," && !inQuotes) {
          row.push(current.trim());
          current = "";
        } else {
          current += ch;
        }
      }
      row.push(current.trim());
      return row;
    });
}

export function CsvTable({ code }: CsvTableProps) {
  const rows = useMemo(() => parseCsv(code), [code]);

  if (rows.length === 0) return null;

  const [headers, ...body] = rows;

  return (
    <div className="overflow-x-auto px-4 py-3">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th
                key={i}
                className="px-3 py-2 text-left font-semibold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-surface-divider border border-gray-200 dark:border-surface-border first:rounded-tl-lg last:rounded-tr-lg"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr
              key={ri}
              className="even:bg-gray-50 dark:even:bg-surface-raised hover:bg-gray-100 dark:hover:bg-surface-raised transition-colors"
            >
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className="px-3 py-2 text-gray-600 dark:text-gray-400 border border-gray-100 dark:border-surface-selected"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

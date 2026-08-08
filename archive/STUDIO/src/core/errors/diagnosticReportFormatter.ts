import type { DiagnosticReport } from "./diagnosticTypes";

export function formatDiagnosticReport(report: DiagnosticReport): string {
  let output = "=== STUDIO Diagnostic Report ===\n\n";
  output += `Generated: ${new Date(report.timestamp).toISOString()}\n`;
  output += `Environment: ${report.environment}\n`;
  output += `Platform: ${report.platform}\n\n`;

  output += "=== Summary ===\n";
  output += `Total Tests: ${report.summary.total}\n`;
  output += `Passed: ${report.summary.passed}\n`;
  output += `Failed: ${report.summary.failed}\n`;
  output += `Warnings: ${report.summary.warnings}\n`;
  output += `Skipped: ${report.summary.skipped}\n\n`;

  const categories = [...new Set(report.tests.map((test) => test.category))];

  for (const category of categories) {
    const categoryTests = report.tests.filter((test) => test.category === category);
    output += `=== ${category.toUpperCase()} TESTS ===\n`;

    for (const test of categoryTests) {
      const status = test.status.toUpperCase().padEnd(8);
      output += `[${status}] ${test.name}\n`;
      output += `           ${test.message}\n`;
      if (test.duration) {
        output += `           Duration: ${test.duration}ms\n`;
      }
      output += "\n";
    }
  }

  output += "=== Recommendations ===\n";
  report.recommendations.forEach((recommendation, index) => {
    output += `${index + 1}. ${recommendation}\n`;
  });

  return output;
}

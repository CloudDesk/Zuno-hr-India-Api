import {
  buildReconciliationReport,
  disconnect,
  parseReconciliationArgs,
  writeReconciliationReport,
} from './leave-summary-reconciliation';

async function main(): Promise<void> {
  const options = parseReconciliationArgs(process.argv.slice(2));
  const report = await buildReconciliationReport(options);
  const files = writeReconciliationReport(report, options.outDir);

  console.log('Leave summary reconciliation report generated.');
  console.log(`Options: ${JSON.stringify(options)}`);
  console.log(`Summary rows: ${report.totals.summaryRows}`);
  console.log(`Rows needing update: ${report.totals.rowsNeedingUpdate}`);
  console.log(`Leave detail rows counted: ${report.totals.leaveDetails}`);
  console.log(`Unknown leave type rows: ${report.totals.unknownLeaveDetails}`);
  console.log(`Missing summary rows: ${report.totals.missingSummaryRows}`);
  console.log(`Output directory: ${files.directory}`);
  console.log(`Report CSV: ${files.reportCsv}`);
}

main()
  .catch((error) => {
    console.error('Failed to generate leave summary reconciliation report:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnect();
  });

import {
  applyReconciliationReport,
  buildReconciliationReport,
  disconnect,
  parseReconciliationArgs,
  writeReconciliationReport,
} from './leave-summary-reconciliation';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const confirmed = args.includes('--confirm');
  const options = parseReconciliationArgs(args.filter((arg) => arg !== '--confirm'));

  if (!confirmed) {
    throw new Error('This script updates the database. Re-run with --confirm after reviewing the report.');
  }

  const report = await buildReconciliationReport(options);
  const files = writeReconciliationReport(report, options.outDir);

  console.log('Pre-sync reconciliation report generated.');
  console.log(`Rows needing update: ${report.totals.rowsNeedingUpdate}`);
  console.log(`Report CSV: ${files.reportCsv}`);

  const result = await applyReconciliationReport(report);

  console.log('Leave summary sync completed.');
  console.log(`Attempted rows: ${result.attempted}`);
  console.log(`Updated/upserted rows: ${result.updated}`);
  console.log(`Skipped rows: ${result.skipped}`);
}

main()
  .catch((error) => {
    console.error('Failed to sync leave summaries:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnect();
  });

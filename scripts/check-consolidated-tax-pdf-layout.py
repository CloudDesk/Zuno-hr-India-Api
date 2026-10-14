"""Validate the synthetic PDF from verify-consolidated-tax-pdf-layout.cjs (no live data)."""
import json
import re
import sys
from pathlib import Path
from pypdf import PdfReader

pdf_path = Path(sys.argv[1] if len(sys.argv) > 1 else 'tmp/pdfs/consolidated-layout-125.pdf')
count = int(sys.argv[2] if len(sys.argv) > 2 else 125)
reader = PdfReader(pdf_path)
pages = [page.extract_text() or '' for page in reader.pages]
assert len(pages) == count * 3, f'Unexpected pagination: {len(pages)}'
for index, page in enumerate(pages):
    match = re.search(r'Page\s+(\d+)\s+of\s+(\d+)', page)
    assert match and int(match[1]) == index + 1 and int(match[2]) == len(pages), f'Incorrect footer on page {index+1}'
    assert 'Created on:' in page and 'India time' in page
    if index % 3 == 0:
        employee_number = index // 3 + 1
        assert f'Synthetic Employee {employee_number:03}' in page
        assert 'Synthetic Layout Company' in page
        assert 'Synthetic Organisation Office Address' in page
        assert '2026-2027' in page
    else:
        assert 'Synthetic Layout Company' not in page, f'Repeated header on page {index+1}'
        assert 'Employee No.' not in page
    for removed in ('O) Tax Paid', 'P) Relief', 'Q) Annual', 'R) TDS', 'S) Balance', 'Section 87A Rebate', 'Monthly Rent'):
        assert removed not in page, f'Removed section found: {removed}'
for index in range(count):
    final_page = pages[index * 3 + 2]
    assert 'N) Total Tax to be Paid' in final_page
    if index % 3 == 0:
        assert '50,250.00' in final_page and '2,010.00' in final_page and '52,260.00' in final_page
        assert '-2,00,000.00' in final_page
    else:
        assert '50,250.00' not in final_page and '52,260.00' not in final_page
        assert '0.00' in final_page
print(json.dumps({'employees': count, 'pages': len(pages), 'first_page_headers': count, 'tax_and_zero_values': 'passed', 'footers': 'passed', 'hard_stop_N': 'passed'}))

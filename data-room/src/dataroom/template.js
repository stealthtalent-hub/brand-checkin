// The "best-practice" structure for a startup fundraising / VC due-diligence
// data room. Each category becomes a numbered top-level folder. The `expected`
// list is the diligence checklist used to detect gaps, and `subfolders` are the
// conventional sub-divisions investors look for.
//
// Ordering and naming follow common VC diligence request lists (corporate,
// cap table, financials, legal, IP, team, product, market, traction, raise).

const CATEGORIES = [
  {
    key: 'CORPORATE',
    folder: '01_Corporate_and_Organizational',
    title: 'Corporate & Organizational',
    description:
      'Formation and governance documents that establish the company as a legal entity.',
    subfolders: ['Formation', 'Governance', 'Board_and_Minutes'],
    expected: [
      'Certificate of Incorporation (and all amendments)',
      'Bylaws',
      'Good standing certificate',
      'Board consents and meeting minutes',
      'Organizational chart / subsidiary list',
      'EIN / tax registration documents'
    ]
  },
  {
    key: 'CAP_TABLE',
    folder: '02_Cap_Table_and_Equity',
    title: 'Cap Table & Equity',
    description:
      'The fully-diluted ownership picture: who owns what, and the agreements behind it.',
    subfolders: ['Cap_Table', 'Equity_Agreements', 'Option_Plan', 'SAFEs_and_Notes'],
    expected: [
      'Current fully-diluted capitalization table',
      'Stock purchase / founder vesting agreements',
      'Stock option plan and form of option agreement',
      'SAFE / convertible note agreements',
      'Prior financing round documents (term sheets, SPAs)',
      '409A valuation report'
    ]
  },
  {
    key: 'FINANCIALS',
    folder: '03_Financials',
    title: 'Financials',
    description:
      'Historical performance, current model, and the metrics that show how the business runs.',
    subfolders: ['Statements', 'Model_and_Projections', 'Metrics', 'Tax', 'Banking'],
    expected: [
      'Income statement, balance sheet, cash-flow (last 2–3 years + YTD)',
      'Financial model / projections (3–5 years)',
      'KPI / metrics dashboard (MRR, ARR, burn, runway, CAC, LTV)',
      'Monthly management accounts',
      'Tax returns and filings',
      'Bank statements / debt schedule'
    ]
  },
  {
    key: 'LEGAL',
    folder: '04_Legal_and_Contracts',
    title: 'Legal & Contracts',
    description:
      'Material agreements, obligations, and any litigation or regulatory matters.',
    subfolders: ['Commercial_Contracts', 'Customer_and_Vendor', 'Litigation', 'Insurance', 'Compliance'],
    expected: [
      'Material customer contracts',
      'Material supplier / vendor agreements',
      'Partnership / reseller agreements',
      'Litigation history and pending claims (or a "none" memo)',
      'Insurance policies',
      'Regulatory / compliance documentation'
    ]
  },
  {
    key: 'IP',
    folder: '05_Intellectual_Property',
    title: 'Intellectual Property',
    description:
      'Ownership and protection of the company’s core technology and brand.',
    subfolders: ['Patents_and_Trademarks', 'IP_Assignments', 'Licenses', 'Open_Source'],
    expected: [
      'Patent and trademark filings / registrations',
      'IP assignment agreements (founders, employees, contractors)',
      'Inbound / outbound license agreements',
      'Open-source usage and license compliance summary',
      'Domain name registrations',
      'Trade-secret / confidentiality policy'
    ]
  },
  {
    key: 'TEAM',
    folder: '06_Team_and_HR',
    title: 'Team & HR',
    description:
      'The people, their agreements, and the equity and policies that retain them.',
    subfolders: ['Org_and_Bios', 'Employment_Agreements', 'Contractors', 'Policies'],
    expected: [
      'Team roster with roles and start dates',
      'Founder and key-employee bios / resumes',
      'Employment agreements and offer letters',
      'Contractor / consulting agreements',
      'Employee handbook and HR policies',
      'Compensation and benefits summary'
    ]
  },
  {
    key: 'PRODUCT',
    folder: '07_Product_and_Technology',
    title: 'Product & Technology',
    description:
      'What the company has built, how it works, and the roadmap ahead.',
    subfolders: ['Overview', 'Architecture', 'Roadmap', 'Security_and_Data'],
    expected: [
      'Product overview / demo materials',
      'Technical architecture documentation',
      'Product roadmap',
      'Security, privacy, and data-handling overview (SOC 2, GDPR, etc.)',
      'Technology stack and infrastructure summary'
    ]
  },
  {
    key: 'MARKET',
    folder: '08_Market_and_Competition',
    title: 'Market & Competition',
    description:
      'The size of the opportunity and how the company is positioned within it.',
    subfolders: ['Market_Analysis', 'Competitive_Landscape', 'Go_To_Market'],
    expected: [
      'Market sizing (TAM / SAM / SOM)',
      'Competitive landscape / positioning',
      'Go-to-market strategy',
      'Industry / analyst research'
    ]
  },
  {
    key: 'TRACTION',
    folder: '09_Customers_and_Traction',
    title: 'Customers & Traction',
    description:
      'Evidence that customers want the product: pipeline, retention, and proof points.',
    subfolders: ['Pipeline', 'Case_Studies', 'Retention_and_Cohorts', 'References'],
    expected: [
      'Customer list / pipeline summary',
      'Case studies and testimonials',
      'Retention and cohort analysis',
      'Customer references (with contact permission)',
      'NPS / customer satisfaction data'
    ]
  },
  {
    key: 'FUNDRAISING',
    folder: '10_Fundraising_and_Investor_Materials',
    title: 'Fundraising & Investor Materials',
    description:
      'The narrative and materials for the current raise.',
    subfolders: ['Pitch_Deck', 'Investor_Updates', 'Use_of_Funds', 'Data_Room_Memo'],
    expected: [
      'Current pitch deck',
      'Executive summary / one-pager',
      'Use of funds breakdown',
      'Prior investor updates',
      'Current round term sheet (if any)'
    ]
  }
];

// A holding area for files the AI could not confidently place.
const UNSORTED = {
  key: 'UNSORTED',
  folder: '99_Unsorted_for_Review',
  title: 'Unsorted (Needs Review)',
  description: 'Files that could not be confidently categorized and need a human eye.'
};

// The intro folder where the generated index / cover documents live.
const START_HERE = {
  folder: '00_Start_Here',
  title: 'Start Here'
};

const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);
const BY_KEY = Object.fromEntries([...CATEGORIES, UNSORTED].map((c) => [c.key, c]));

module.exports = { CATEGORIES, UNSORTED, START_HERE, CATEGORY_KEYS, BY_KEY };

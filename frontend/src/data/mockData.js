/**
 * Centralized mock display values for the dashboard.
 * Swap imports or add a data hook to fetch from API for real data.
 */
export const mockData = {
  // Dashboard hero metrics
  netWorth: {
    current: 124500,
    currency: 'CAD',
    cohort: {
      percentile: 15,
      label: 'Top 15% for your cohort',
      status: 'improving', // 'improving', 'stable', or 'declining'
    },
  },
  runwayMonths: 6.4,
  runwayLabel: 'Personal Runway',
  personalInflation: 4.2,
  inflationTrend: 'up', // or 'down'

  // Progress nudge
  profileCompletionPercent: 35,
  profileCompletionLabel: 'Complete your full finance picture',

  // Wealth tab - accounts grouped
  liquid: [
    { provider: 'TD Checking', balance: 8450 },
    { provider: 'Scotia Savings', balance: 12200 },
    { provider: 'EQ Bank HISA', balance: 18500 },
  ],
  taxAdvantaged: [
    { type: 'TFSA', provider: 'Wealthsimple', balance: 42500 },
    { type: 'RRSP', provider: 'Questrade', balance: 31200 },
    { type: 'FHSA', provider: 'Wealthsimple', balance: 8000 },
  ],
  liabilities: [
    { provider: 'TD Credit Card', balance: -2450 },
    { provider: 'OSAP Student Loan', balance: -15000 },
  ],

  // Cashflow tab
  categoryBreakdowns: [
    { category: 'Groceries', amount: 624 },
    { category: 'Dining', amount: 412 },
    { category: 'Transport', amount: 289 },
    { category: 'Utilities', amount: 198 },
    { category: 'Entertainment', amount: 156 },
    { category: 'Subscriptions', amount: 89 },
  ],

  // Data Editor - recent transactions
  recentTransactions: [
    { id: 1, date: '2025-02-28', description: 'Loblaws', amount: -87.42, category: 'Groceries' },
    { id: 2, date: '2025-02-28', description: 'Salary Deposit', amount: 4500, category: 'Income' },
    { id: 3, date: '2025-02-27', description: 'Spotify', amount: -11.99, category: 'Subscriptions' },
    { id: 4, date: '2025-02-27', description: 'Tim Hortons', amount: -6.25, category: 'Dining' },
    { id: 5, date: '2025-02-26', description: 'TTC Monthly Pass', amount: -156, category: 'Transport' },
    { id: 6, date: '2025-02-26', description: 'Hydro One', amount: -89.50, category: 'Utilities' },
  ],

  // AI Insights placeholder tips
  aiInsights: [
    'Consider maxing your TFSA contribution before the end of the year to maximize tax-free growth.',
    'Your personal inflation is above the national average. Review discretionary spending in Dining and Entertainment.',
    'You have 6.4 months of runway. Aim for 9–12 months for stronger financial resilience.',
  ],
};

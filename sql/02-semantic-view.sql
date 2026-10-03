CREATE OR REPLACE SEMANTIC VIEW COCO_QBR_DEMO.ANALYTICS.QBR_FINANCE
TABLES (
 finance AS COCO_QBR_DEMO.ANALYTICS.FINANCE_MONTHLY
 PRIMARY KEY (MONTH, CUSTOMER_ID, PRODUCT)
 COMMENT = 'Synthetic customer-product-month financial actuals and allocated budget. USD, calendar quarters. Closed through September 2026.'
)
DIMENSIONS (
 finance.month AS finance.MONTH COMMENT = 'First date of the closed calendar month',
 finance.quarter AS finance.QUARTER COMMENT = 'Calendar reporting quarter in YYYY-QN format',
 finance.customer AS finance.CUSTOMER WITH SYNONYMS ('account') COMMENT = 'Synthetic customer name',
 finance.region AS finance.REGION COMMENT = 'Americas, EMEA, or APAC. Europe maps to EMEA in this demo.',
 finance.segment AS finance.SEGMENT COMMENT = 'Enterprise or Commercial',
 finance.product AS finance.PRODUCT COMMENT = 'Platform or Analytics'
)
METRICS (
 finance.actual_revenue AS SUM(finance.ACTUAL_REVENUE) WITH SYNONYMS ('revenue', 'sales') COMMENT = 'Recognized revenue in USD. Not bookings, cash or ARR.',
 finance.budget_revenue AS SUM(finance.BUDGET_REVENUE) WITH SYNONYMS ('budget', 'plan') COMMENT = 'Approved synthetic budget allocated to customer-product-month grain',
 finance.revenue_variance AS SUM(finance.ACTUAL_REVENUE) - SUM(finance.BUDGET_REVENUE) COMMENT = 'Actual minus budget in USD. Negative means below budget.',
 finance.revenue_variance_pct AS 100.0 * (SUM(finance.ACTUAL_REVENUE) - SUM(finance.BUDGET_REVENUE)) / NULLIF(SUM(finance.BUDGET_REVENUE),0) COMMENT = 'Percentage points, e.g. -5 means five percent below budget. Null when budget is zero.',
 finance.gross_profit AS SUM(finance.ACTUAL_REVENUE) - SUM(finance.ACTUAL_COGS) COMMENT = 'Recognized revenue less directly attributable cost of goods sold',
 finance.gross_margin AS 100.0 * (SUM(finance.ACTUAL_REVENUE) - SUM(finance.ACTUAL_COGS)) / NULLIF(SUM(finance.ACTUAL_REVENUE),0) COMMENT = 'Weighted gross margin as a percentage. Never average row margins.'
)
COMMENT = 'Meridian Cloud QBR demo v1. All data fictional; USD calendar quarters, ending September 2026.';
GRANT SELECT ON SEMANTIC VIEW COCO_QBR_DEMO.ANALYTICS.QBR_FINANCE TO ROLE COCO_QBR_READER;
-- Assign COCO_QBR_READER to a dedicated runtime user separately. Do not give that user admin roles.

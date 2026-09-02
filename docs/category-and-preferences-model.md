# Category, alias, and preference model

## Categories

The default category catalogue is: Pantry & Groceries; Fresh Produce; Meat, Poultry & Seafood; Dairy & Eggs; Bakery; Snacks & Confectionery; Beverages; Household Cleaning; Home & Kitchen; Personal Care & Cosmetics; Medicine & Health; Baby Care; Clothing & Accessories; Electronics & Appliances; Toys & Games; Stationery & Books; Pet Supplies; Eating Out & Prepared Food; Transport & Fuel; and Miscellaneous / Unclear.

The receipt-extraction model may select only one of these labels or leave an item uncategorized. The prompt intentionally supplies category names without definitions or examples: extra definitions increase the request's input tokens and cannot reduce model latency or token usage. Users can still add, rename, deactivate, or manually apply custom categories during review.

BillsEye uses a stable category ID as the canonical category value for every newly created or updated receipt item. The category document supplies the display name, so a rename changes presentation without changing modern receipts, reports, or aliases.

Older receipts may contain only the former `category` display-name field. They remain valid and readable. Each category keeps prior names in `legacyNames`, allowing those historical values to resolve to the renamed category. The next ordinary application write also converts any matching legacy item to `categoryId`. No background migration or destructive rewrite is required.

Deleting a category with references requires a replacement. Each affected receipt is updated with its current revision. If another device updates a receipt first, BillsEye reloads it and applies the same deterministic replacement once; if any receipt cannot be updated safely, the category is retained and the problem is reported. Aliases pointing to the removed category move to the replacement at the same time.

## Merchant aliases

A merchant alias is an exact, case- and whitespace-normalized merchant name mapped to one active category ID. When a receipt is opened for review, a matching alias supplies that category to line items that have not been edited by a person. It does not alter confirmed receipts and never overwrites a human edit. This makes alias application deterministic without asking the extraction model to make financial decisions.

## Preferences

Currency, locale, and time zone are centralized as PKR, `en-PK`, and `Asia/Karachi` throughout the current release. They are shown as fixed values rather than editable controls because totals, reports, and transaction-date analytics all use that one regional configuration.

The currently supported editable preference is the receipt totals mismatch tolerance. It is stored in minor units and used by both receipt review surfaces when determining whether printed and calculated totals match.

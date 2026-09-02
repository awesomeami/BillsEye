/**
 * The category choices supplied to the receipt-extraction model. Keep this
 * tuple as the single source of truth for the model contract and the seeded
 * category catalogue.
 */
export const DEFAULT_CATEGORIES = [
  'Pantry & Groceries',
  'Fresh Produce',
  'Meat, Poultry & Seafood',
  'Dairy & Eggs',
  'Bakery',
  'Snacks & Confectionery',
  'Beverages',
  'Household Cleaning',
  'Home & Kitchen',
  'Personal Care & Cosmetics',
  'Medicine & Health',
  'Baby Care',
  'Clothing & Accessories',
  'Electronics & Appliances',
  'Toys & Games',
  'Stationery & Books',
  'Pet Supplies',
  'Eating Out & Prepared Food',
  'Transport & Fuel',
  'Miscellaneous / Unclear',
] as const;

export type DefaultCategoryName = (typeof DEFAULT_CATEGORIES)[number];

export interface DefaultCategoryDefinition {
  id: string;
  name: DefaultCategoryName;
  /** The original display name for a pre-existing default category. */
  previousName?: string;
}

/** Increment when the built-in catalogue requires an account migration. */
export const CATEGORY_CATALOG_VERSION = 2;

/**
 * Stable IDs preserve existing receipt and merchant-alias references while
 * the display names become more precise. New categories use readable IDs.
 */
export const DEFAULT_CATEGORY_CATALOG: readonly DefaultCategoryDefinition[] = [
  { id: 'cat_groceries', name: 'Pantry & Groceries', previousName: 'Groceries' },
  { id: 'cat_fruit___vegetables', name: 'Fresh Produce', previousName: 'Fruit & Vegetables' },
  { id: 'cat_meat', name: 'Meat, Poultry & Seafood', previousName: 'Meat' },
  { id: 'cat_dairy_eggs', name: 'Dairy & Eggs' },
  { id: 'cat_bakery', name: 'Bakery' },
  { id: 'cat_snacks_confectionery', name: 'Snacks & Confectionery' },
  { id: 'cat_beverages', name: 'Beverages' },
  { id: 'cat_household', name: 'Household Cleaning', previousName: 'Household' },
  { id: 'cat_home_kitchen', name: 'Home & Kitchen' },
  { id: 'cat_personal_care_cosmetics', name: 'Personal Care & Cosmetics' },
  { id: 'cat_medicine', name: 'Medicine & Health', previousName: 'Medicine' },
  { id: 'cat_baby_care', name: 'Baby Care' },
  { id: 'cat_clothing_accessories', name: 'Clothing & Accessories' },
  { id: 'cat_electronics_appliances', name: 'Electronics & Appliances' },
  { id: 'cat_toys_games', name: 'Toys & Games' },
  { id: 'cat_stationery_books', name: 'Stationery & Books' },
  { id: 'cat_pet_supplies', name: 'Pet Supplies' },
  { id: 'cat_eating_out', name: 'Eating Out & Prepared Food', previousName: 'Eating Out' },
  { id: 'cat_transport_fuel', name: 'Transport & Fuel' },
  { id: 'cat_miscellaneous', name: 'Miscellaneous / Unclear', previousName: 'Miscellaneous' },
];

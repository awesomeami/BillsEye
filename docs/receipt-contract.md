# Receipt data contract

Receipt amounts are integers in minor currency units. Optional extracted text is
stored as `null` when it is absent or unreadable; it is never replaced with a
made-up value. Each receipt item has an id, optional nullable text and amount
fields, a confidence value, a user-edit flag, and warning strings. Extraction
metadata includes the requested and actual model identifiers, a string schema
version, and elapsed milliseconds.

## Item storage and limit

The supported item limit is **40**. Firestore Security Rules have no list
iteration, so validating a 40-element `items` list inside the receipt document
exceeded the 1,000-expression evaluation limit and rejected otherwise valid
writes. Receipt items are therefore stored as documents in the receipt's
`items` subcollection. Rules validate every item document independently,
including all fields, bounds, and unexpected-field checks. The document slot
is restricted to 0 through 39, which enforces the 40-item maximum without
list-wide Rules evaluation.

When Gemini returns more than 40 items, the server retains the first 40 and
adds an extraction warning visible in review. The review screen shows the
current count and prevents adding a 41st item. Zod, Firestore Rules, the
Firebase blueprint, server response handling, and tests enforce the same
limit. Existing documents remain readable when they omit optional fields; no
destructive migration is required.

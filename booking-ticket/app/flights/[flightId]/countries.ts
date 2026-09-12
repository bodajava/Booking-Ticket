/**
 * Passport-issuing countries offered in the nationality field.
 *
 * Deliberately a short, ordered list rather than all 249 ISO entries: these are
 * the countries the seeded route network actually serves, which keeps the
 * select usable on a phone. Stored as ISO 3166-1 alpha-2, which is what the
 * `passengers.nationality` column and every downstream airline system expect.
 */
export const COUNTRIES: Array<{ code: string; name: string }> = [
  { code: "EG", name: "Egypt" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "TR", name: "Türkiye" },
  { code: "KE", name: "Kenya" },
  { code: "TH", name: "Thailand" },
  { code: "PT", name: "Portugal" },
  { code: "GB", name: "United Kingdom" },
  { code: "FR", name: "France" },
  { code: "US", name: "United States" },
  { code: "QA", name: "Qatar" },
  { code: "DE", name: "Germany" },
  { code: "NL", name: "Netherlands" },
  { code: "IN", name: "India" },
  { code: "PK", name: "Pakistan" },
  { code: "NG", name: "Nigeria" },
  { code: "ZA", name: "South Africa" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
];

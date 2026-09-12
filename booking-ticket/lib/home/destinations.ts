/**
 * Presentation data for the destination cards.
 *
 * Split deliberately from anything the booking engine computes. The *price* on
 * each card is the real cheapest fare for that route, read from `flights` at
 * request time — see `getFeaturedDestinations`. Everything here is editorial:
 * the photograph, the headline a marketer would write, the review score, and
 * whether a promotion is running. None of it is invented pricing.
 */

export type DestinationCopy = {
  /** IATA code of the arrival airport, the join key back to real flights. */
  code: string;
  title: string;
  city: string;
  /** Unsplash photo id; rendered through next/image. */
  photo: string;
  rating: number;
  /** Percent off, shown as a badge. `null` means no promotion. */
  discount: number | null;
  tags: Array<"popular" | "offers">;
};

export const DESTINATIONS: DestinationCopy[] = [
  {
    code: "DXB",
    title: "Dubai Marina & Burj",
    city: "Dubai",
    photo: "photo-1512453979798-5ea266f8880c",
    rating: 4.9,
    discount: 20,
    tags: ["popular", "offers"],
  },
  {
    code: "LHR",
    title: "Westminster & Thames",
    city: "London",
    photo: "photo-1513635269975-59663e0ac1ad",
    rating: 4.7,
    discount: null,
    tags: ["popular"],
  },
  {
    code: "JFK",
    title: "Statue of Liberty",
    city: "New York",
    photo: "photo-1485871981521-5b1fd3805eee",
    rating: 4.8,
    discount: 25,
    tags: ["popular", "offers"],
  },
  {
    code: "IST",
    title: "Bosphorus & Old City",
    city: "Istanbul",
    photo: "photo-1541432901042-2d8bd64b4a9b",
    rating: 4.8,
    discount: 30,
    tags: ["popular", "offers"],
  },
  {
    code: "CAI",
    title: "Pyramids & the Nile",
    city: "Cairo",
    photo: "photo-1568322445389-f64ac2515020",
    rating: 4.6,
    discount: null,
    tags: ["popular"],
  },
  {
    code: "BKK",
    title: "Temples & Chao Phraya",
    city: "Bangkok",
    photo: "photo-1508009603885-50cf7c579365",
    rating: 4.7,
    discount: 15,
    tags: ["offers"],
  },
  {
    code: "LIS",
    title: "Alfama & the Tagus",
    city: "Lisbon",
    photo: "photo-1585208798174-6cedd86e019a",
    rating: 4.7,
    discount: null,
    tags: ["popular"],
  },
  {
    code: "NBO",
    title: "Savannah & Skyline",
    city: "Nairobi",
    photo: "photo-1611348586804-61bf6c080437",
    rating: 4.5,
    discount: 20,
    tags: ["offers"],
  },
];

export const unsplashUrl = (photo: string, width: number) =>
  `https://images.unsplash.com/${photo}?auto=format&fit=crop&w=${width}&q=70`;

/** The airliner behind the hero headline. */
export const HERO_PHOTO = "photo-1569154941061-e231b4725ef1";

/**
 * Photography is warmed and darkened toward the palette before it is used.
 *
 * DESIGN.MD allows one accent and a warm charcoal ground; a cool blue stock
 * photo dropped in raw reads as a different product. Desaturating slightly and
 * laying a warm wash over the top pulls every image into the same room, and
 * has the side effect of guaranteeing the headline's contrast whatever the
 * photograph happens to be doing behind it.
 */
export const PHOTO_FILTER = "[filter:saturate(0.72)_contrast(1.06)_brightness(0.86)]";
export const PHOTO_WASH =
  "absolute inset-0 bg-[#d97a2c] opacity-[0.10] mix-blend-overlay";

"use client";

import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The site header.
 *
 * Deliberately absent from `/verify/*`. That route is what a QR scan lands on,
 * usually on a gate agent's phone: they are not a customer, there is nothing
 * for them to sign up for, and a "Register" button beside a boarding-pass
 * verdict is noise at best and a misdirection at worst. The verification page
 * carries its own minimal wordmark instead, so it reads as a standalone
 * document rather than a page inside an app they are not logged into.
 */
const CHROMELESS = [/^\/verify(\/|$)/];

const NAV = [
  { href: "/flights", label: "Flights" },
  { href: "/#travelers-spot", label: "Destinations" },
  { href: "/#fleet", label: "Fleet & Cabins" },
  { href: "/#offers", label: "Special Offers" },
  { href: "/#why", label: "Why AeroFlow" },
];

export function SiteHeader() {
  const pathname = usePathname();
  if (CHROMELESS.some((pattern) => pattern.test(pathname))) return null;

  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-stage/85 backdrop-blur">
      <div className="mx-auto flex h-[68px] w-full max-w-[1280px] items-center gap-6 px-4 sm:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-[10px]">
          {/* Carrier mark: the wordmark's initials, set in the display face so
              the badge and the name read as one lockup. */}
          <span className="flex h-9 w-9 items-center justify-center rounded-md border border-hairline bg-card font-display text-[15px] leading-none text-bone">
            AF
          </span>
          <span className="leading-none">
            <span className="block font-display text-[1.25rem] tracking-[-0.02em] text-bone">
              AeroFlow
            </span>
            <span className="eyebrow mt-[3px] block">Carrier Engine</span>
          </span>
        </Link>

        <nav aria-label="Main" className="ml-2 hidden items-center gap-6 lg:flex">
          {NAV.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="text-[13px] font-medium text-bone-50 transition-colors duration-200 hover:text-bone"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <Show when="signed-out">
            <SignInButton>
              <button className="hidden cursor-pointer whitespace-nowrap rounded-full px-4 py-[11px] text-[0.8125rem] font-medium text-bone-50 transition-colors duration-200 hover:text-bone sm:block">
                Sign in
              </button>
            </SignInButton>
            <SignUpButton>
              <button className="cursor-pointer whitespace-nowrap rounded-pill bg-bone px-[18px] py-[11px] text-[0.8125rem] font-semibold text-stage shadow-button transition-[filter] duration-200 hover:brightness-95 sm:px-[22px]">
                Register
              </button>
            </SignUpButton>
          </Show>
          <Show when="signed-in">
            <UserButton />
          </Show>
        </div>
      </div>
    </header>
  );
}

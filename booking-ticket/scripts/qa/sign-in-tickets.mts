/** Mints Clerk sign-in tickets for headless QA (Turnstile blocks real sign-up). */
const key = process.env.CLERK_SECRET_KEY!;
const api = "https://api.clerk.com/v1";
const h = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function ticketFor(email: string) {
  const list = await fetch(`${api}/users?email_address=${encodeURIComponent(email)}`, { headers: h });
  const users = await list.json();
  let user = Array.isArray(users) ? users[0] : undefined;
  if (!user) {
    const res = await fetch(`${api}/users`, {
      method: "POST", headers: h,
      body: JSON.stringify({ email_address: [email], password: "SeatMapQA!2026x", skip_password_checks: true }),
    });
    user = await res.json();
    if (!user.id) throw new Error("create failed: " + JSON.stringify(user).slice(0, 300));
  }
  const t = await fetch(`${api}/sign_in_tokens`, {
    method: "POST", headers: h, body: JSON.stringify({ user_id: user.id, expires_in_seconds: 3600 }),
  });
  const token = await t.json();
  if (!token.token) throw new Error("token failed: " + JSON.stringify(token).slice(0, 300));
  return { userId: user.id as string, token: token.token as string };
}

const out: Record<string, { userId: string; token: string }> = {};
for (const email of process.argv.slice(2)) out[email] = await ticketFor(email);
console.log(JSON.stringify(out));
process.exit(0);

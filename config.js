// QUEENEE site settings. The pages read everything from here.
// Payment handles (Stripe link, Cash App, Zelle) are stored with the backend
// in the queenee_settings table and only shown to a customer after sign-up.
window.QUEENEE = {
  // Backend: saves sign-ups, tracks payment status, powers admin.html.
  api: "https://lsxdlmrjrcivxwgfkpop.supabase.co/functions/v1/queenee",

  // Shown on the page. The backend holds the same numbers and decides the amount due.
  prices: { website: 500, addon: 99, addonMonths: 5 },

  calltwinUrl: "https://hsw365.github.io/calltwin/",
  contactEmail: "hsw365media@gmail.com"
};

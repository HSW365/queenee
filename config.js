// QUEENEE site settings. Edit these values only; the pages read everything from here.
window.QUEENEE = {
  // CallTwin backend on Render: stores orders, runs Stripe webhooks, creates CallTwin logins.
  api: "https://calltwin.onrender.com",

  // Stripe Payment Links.
  // website: $500 one-time.
  // bundle:  $500 one-time + $99/month recurring in the SAME link ($599 due today).
  //          CallTwin's backend stops the subscription after the 6th payment.
  paymentLinks: {
    website: "https://buy.stripe.com/6oU7sL4L5dMO182b3Z3VC0o",
    bundle: "" // paste the Website + CallTwin Payment Link here
  },

  prices: { website: 500, addon: 99, addonMonths: 5 }, // must match the Stripe links

  calltwinDashboard: "https://hsw365.github.io/calltwin/dashboard/",
  contactEmail: "hsw365media@gmail.com"
};

import type { Config } from 'tailwindcss'

export default {
  content: ['./client/index.html', './client/src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      /**
       * `-ml-5.5` centres AllocBar's 44px (`w-11`) drag handle on the divider it controls: half
       * of 2.75rem is 1.375rem. Tailwind v3's default spacing scale has no 5.5 step — it goes in
       * 0.5s only up to 3.5, then whole numbers — so that class compiled to NOTHING and the
       * handle was laid out starting AT the boundary instead of straddling it. Every divider,
       * and the visible line inside it, sat ~22px right of the colour edge it was supposed to
       * mark: the "bars don't line up" report of 2026-09-01. Registering the step is what makes
       * the class real; the markup was always correct.
       */
      spacing: { '5.5': '1.375rem' },
    },
  },
  plugins: [],
} satisfies Config

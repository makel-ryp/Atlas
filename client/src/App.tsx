import { useEffect, useState } from 'react'

// Mirrors the columns GET /api/plans selects. Not derived from eco's PlanRow on purpose: the
// route returns a deliberate subset (no stripe_price_id, no internal pricing notes).
interface Plan {
  code: string
  name: string
  rank: number
  audience: string
  isActive: boolean
  priceCents: number | null
  currency: string
  interval: string | null
}

// null price is meaningful, not missing data — those tiers are deliberately unpriced.
function formatPrice(plan: Plan) {
  if (plan.priceCents === null) return 'not priced'
  const amount = (plan.priceCents / 100).toFixed(2)
  return plan.interval ? `${amount} ${plan.currency}/${plan.interval}` : `${amount} ${plan.currency}`
}

export default function App() {
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/plans')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(setPlans)
      .catch((err: Error) => setError(err.message))
  }, [])

  if (error) return <p>Failed to load plans: {error}</p>
  if (!plans) return <p>Loading…</p>

  return (
    <main>
      <h1>Atlas</h1>
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Code</th>
            <th>Name</th>
            <th>Audience</th>
            <th>Price</th>
            <th>Sellable</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((plan) => (
            <tr key={plan.code}>
              <td>{plan.rank}</td>
              <td>{plan.code}</td>
              <td>{plan.name}</td>
              <td>{plan.audience}</td>
              <td>{formatPrice(plan)}</td>
              <td>{plan.isActive ? 'yes' : 'no'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}

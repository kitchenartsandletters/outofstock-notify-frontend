import { useEffect, useState } from 'react'

type InterestEntry = {
  email: string
  product_id: number
  product_title: string
  created_at: string
}

const AdminDashboard = () => {
  const [data, setData] = useState<InterestEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/interest?token${import.meta.env.VITE_ADMIN_TOKEN}`)
        let json: any
        try {
          json = await res.clone().json()
        } catch (e) {
          const errorText = await res.text()
          console.error("Failed to parse JSON:", errorText)
          throw new Error("Malformed JSON")
        }
        if (!res.ok || !json?.data || !Array.isArray(json.data)) {
          throw new Error("Invalid data response")
        }
        setData(json.data)
        setLoading(false)
      } catch (err: any) {
        // fallback to mock data
        setData([
          {
            email: 'test@example.com',
            product_id: 12345,
            product_title: 'The Book of Ferments',
            created_at: new Date().toISOString(),
          },
          {
            email: 'reader@example.com',
            product_id: 98765,
            product_title: 'Cooking in the Shadows',
            created_at: new Date().toISOString(),
          },
        ])
        setError(err.message)
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  console.log("Admin dashboard data:", data)

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Out of Stock Request List</h1>
      {loading && <p>Loading...</p>}
      {error && <p className="text-red-600 text-sm">Error: {error}</p>}
      <table className="w-full table-auto border-collapse border border-gray-300 mt-4 text-sm">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className="border px-4 py-2">Product Title</th>
            <th className="border px-4 py-2">Email</th>
            <th className="border px-4 py-2">Submitted</th>
          </tr>
        </thead>
        <tbody>
          {data.map((entry, idx) => (
            <tr key={idx} className="border-t">
              <td className="border px-4 py-2">{entry.product_title}</td>
              <td className="border px-4 py-2">{entry.email}</td>
              <td className="border px-4 py-2">{new Date(entry.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default AdminDashboard
import { useEffect, useState } from 'react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'


declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}

function decodeHTMLEntities(str: string) {
  const txt = document.createElement("textarea");
  txt.innerHTML = str;
  return txt.value;
}

type InterestEntry = {
  cr_id?: string
  email: string
  isbn?: string
  product_id: number
  product_title: string
  created_at: string
}

const AdminDashboard = () => {
  const [data, setData] = useState<InterestEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortConfig, setSortConfig] = useState<{ key: keyof InterestEntry; direction: 'asc' | 'desc' } | null>(null)
  const [filter, setFilter] = useState("")

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

  // Sort helper
  const sortedData = [...data].sort((a, b) => {
    if (!sortConfig) return 0
    const key = sortConfig.key
    const direction = sortConfig.direction === 'asc' ? 1 : -1
    const aVal = a[key] ?? ''
    const bVal = b[key] ?? ''
    return aVal.toString().localeCompare(bVal.toString()) * direction
  })

  const filteredData = sortedData.filter((entry) =>
    Object.values(entry)
      .join(" ")
      .toLowerCase()
      .includes(filter.toLowerCase())
  )

  // Export CSV
  const exportToCSV = () => {
    const headers = ["ID", "Product Title", "ISBN", "Email", "Submitted", "Link"];
    const rows = filteredData.map((entry: InterestEntry) => [
      `CR${entry.cr_id || "N/A"}`,
      decodeHTMLEntities(entry.product_title),
      entry.isbn || "—",
      entry.email,
      new Date(entry.created_at).toLocaleString(),
      `https://admin.shopify.com/store/castironbooks/products/${entry.product_id}`,
    ]);
    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers, ...rows].map((e) => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "customer_requests.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export PDF
  const exportToPDF = () => {
    const doc = new jsPDF();
    const tableColumn = ["ID", "Product Title", "ISBN", "Email", "Submitted", "Link"];
    const tableRows = filteredData.map((entry: InterestEntry) => [
      entry.cr_id || "CRN/A",
      decodeHTMLEntities(entry.product_title),
      entry.isbn || "—",
      entry.email,
      new Date(entry.created_at).toLocaleString(),
      `https://admin.shopify.com/store/castironbooks/products/${entry.product_id}`,
    ]);
    doc.autoTable({
      head: [tableColumn],
      body: tableRows,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [0, 128, 96] },
    });
    doc.save("customer_requests.pdf");
  };

  return (
    <div className="admin-dashboard-container">
      <h1 className="text-2xl font-bold mb-4">Out of Stock Request List</h1>
      {loading && <p>Loading...</p>}
      {error && <p className="text-red-600 text-sm">Error: {error}</p>}
      <div className="controls-bar">
        <input
          type="text"
          placeholder="Filter by keyword..."
          className="control-input"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="flex gap-2">
          <button onClick={exportToCSV} className="control-button">
            Export CSV
          </button>
          <button onClick={exportToPDF} className="control-button">
            Export PDF
          </button>
          <button onClick={window.print} className="control-button">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 9V2h12v7M6 18h12v4H6v-4zM6 14h12v4H6v-4z" />
            </svg>
          </button>
        </div>
      </div>
      <table className="w-full table-auto border-collapse border border-gray-300 mt-4 text-sm">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th
              className="border px-4 py-2 cursor-pointer"
              onClick={() => {
                const direction = sortConfig?.key === 'cr_id' && sortConfig.direction === 'asc' ? 'desc' : 'asc'
                setSortConfig({ key: 'cr_id', direction })
              }}
            >
              ID {sortConfig?.key === 'cr_id' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th
              className="border px-4 py-2 cursor-pointer"
              onClick={() => {
                const direction = sortConfig?.key === 'product_title' && sortConfig.direction === 'asc' ? 'desc' : 'asc'
                setSortConfig({ key: 'product_title', direction })
              }}
            >
              Product Title {sortConfig?.key === 'product_title' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th
              className="border px-4 py-2 cursor-pointer"
              onClick={() => {
                const direction = sortConfig?.key === 'isbn' && sortConfig.direction === 'asc' ? 'desc' : 'asc'
                setSortConfig({ key: 'isbn', direction })
              }}
            >
              ISBN {sortConfig?.key === 'isbn' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th
              className="border px-4 py-2 cursor-pointer"
              onClick={() => {
                const direction = sortConfig?.key === 'email' && sortConfig.direction === 'asc' ? 'desc' : 'asc'
                setSortConfig({ key: 'email', direction })
              }}
            >
              Email {sortConfig?.key === 'email' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th
              className="border px-4 py-2 cursor-pointer"
              onClick={() => {
                const direction = sortConfig?.key === 'created_at' && sortConfig.direction === 'asc' ? 'desc' : 'asc'
                setSortConfig({ key: 'created_at', direction })
              }}
            >
              Submitted {sortConfig?.key === 'created_at' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th className="border px-4 py-2">Link</th>
          </tr>
        </thead>
        <tbody>
          {filteredData.map((entry, idx) => (
            <tr key={idx} className="border-t">
              <td className="border px-4 py-2">{entry.cr_id || 'CRN/A'}</td>
              <td className="border px-4 py-2">{decodeHTMLEntities(entry.product_title)}</td>
              <td className="border px-4 py-2">{entry.isbn || '—'}</td>
              <td className="border px-4 py-2">{entry.email}</td>
              <td className="border px-4 py-2">{new Date(entry.created_at).toLocaleString()}</td>
              <td className="border px-4 py-2">
                <a
                  href={`https://admin.shopify.com/store/castironbooks/products/${entry.product_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 underline"
                >
                  View
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}


export default AdminDashboard
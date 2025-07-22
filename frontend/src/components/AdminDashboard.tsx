import { useEffect, useState } from 'react'
import jsPDF from 'jspdf'
import 'jspdf-autotable'


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
  request_id?: number
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
      `CR${entry.request_id?.toString().padStart(5, "0") || "N/A"}`,
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
      `CR${entry.request_id?.toString().padStart(5, "0") || "N/A"}`,
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
      <table className="w-full table-auto border-collapse border border-gray-300 mt-4 text-sm">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th
              className="border px-4 py-2 cursor-pointer"
              onClick={() => {
                const direction = sortConfig?.key === 'request_id' && sortConfig.direction === 'asc' ? 'desc' : 'asc'
                setSortConfig({ key: 'request_id', direction })
              }}
            >
              ID {sortConfig?.key === 'request_id' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
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
              <td className="border px-4 py-2">CR{entry.request_id?.toString().padStart(5, '0') || 'N/A'}</td>
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
      <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <input
          type="text"
          placeholder="Filter by keyword..."
          className="border border-gray-300 rounded px-3 py-2 w-full sm:w-64"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="flex gap-2">
          <button onClick={exportToCSV} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">
            Export CSV
          </button>
          <button onClick={exportToPDF} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded">
            Export PDF
          </button>
          <button onClick={window.print} className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded">
            Print
          </button>
        </div>
      </div>
    </div>
  )
}


export default AdminDashboard
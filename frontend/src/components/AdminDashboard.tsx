import { useEffect, useState } from 'react'
import FilterControls, { FilterControlsProps } from './FilterControls';
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import DarkModeToggle from './DarkModeToggle';
import DashboardHeader from './DashboardHeader';


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
  const [filterText, setFilterText] = useState("")
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [selectedFilter, setSelectedFilter] = useState('all');

  const handleFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedFilter(e.target.value);
  };

  const filterOptions = ['all', 'urgent', 'low stock', 'archived'];

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
    const { key, direction } = sortConfig
    const aVal = a[key]
    const bVal = b[key]

    if (aVal == null || bVal == null) return 0;

    if (key === 'cr_id') {
      return aVal.toString().localeCompare(bVal.toString()) * (direction === 'asc' ? 1 : -1);
    }

    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return aVal.localeCompare(bVal) * (direction === 'asc' ? 1 : -1)
    }

    // Safer date comparison for created_at field
    if (key === 'created_at') {
      const aDate = Date.parse(aVal as string);
      const bDate = Date.parse(bVal as string);
      return (aDate - bDate) * (direction === 'asc' ? 1 : -1);
    }

    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return (aVal - bVal) * (direction === 'asc' ? 1 : -1)
    }

    return aVal.toString().localeCompare(bVal.toString()) * (direction === 'asc' ? 1 : -1)
  })

  const filteredData = sortedData.filter((entry) =>
    Object.values(entry)
      .join(" ")
      .toLowerCase()
      .includes(filterText.toLowerCase())
  )

  // Export CSV
  const handleExportCSV = () => {
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
  const handleExportPDF = () => {
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

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className={`p-6 bg-white dark:bg-gray-900 min-h-screen`}>
      <DashboardHeader>
        <DarkModeToggle />
      </DashboardHeader>
      {loading && <p>Loading...</p>}
      {error && <p className="text-red-600 text-sm">Error: {error}</p>}
      {/* Filter and export controls */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4 gap-4">
        <FilterControls
          selectedFilter={selectedFilter}
          handleFilterChange={handleFilterChange}
          filterOptions={filterOptions}
        />
        <div className="flex flex-wrap gap-2 justify-end">
          <button onClick={handleExportCSV} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">Export CSV</button>
          <button onClick={handleExportPDF} className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600">Export PDF</button>
          <button onClick={handlePrint} className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600">🖨️</button>
        </div>
      </div>
      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse border border-gray-200 dark:border-gray-700">
          <thead className="bg-gray-100 dark:bg-gray-800">
            <tr>
              <th className="border px-4 py-2 dark:border-gray-700 text-left">ID</th>
              <th className="border px-4 py-2 dark:border-gray-700 text-left">Product ID</th>
              <th className="border px-4 py-2 dark:border-gray-700 text-left">Product Title</th>
              <th className="border px-4 py-2 dark:border-gray-700 text-left">Email</th>
              <th className="border px-4 py-2 dark:border-gray-700 text-left">Created At</th>
            </tr>
          </thead>
          <tbody>
            {filteredData.map((entry, index) => (
              <tr key={index} className="even:bg-gray-50 dark:even:bg-gray-700">
                <td className="border px-4 py-2 dark:border-gray-700">{entry.cr_id || 'CRN/A'}</td>
                <td className="border px-4 py-2 dark:border-gray-700">{entry.product_id}</td>
                <td className="border px-4 py-2 dark:border-gray-700">{decodeHTMLEntities(entry.product_title)}</td>
                <td className="border px-4 py-2 dark:border-gray-700">{entry.email}</td>
                <td className="border px-4 py-2 dark:border-gray-700">{new Date(entry.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}


export default AdminDashboard
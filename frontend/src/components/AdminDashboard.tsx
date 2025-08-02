import { useEffect, useState } from 'react'
import FilterControls, { FilterControlsProps } from './FilterControls';
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import DashboardHeader from './DashboardHeader';
import ExportButtons from "./ExportButtons";
import AdminTable from './AdminTable';

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
  const [selectedFilter, setSelectedFilter] = useState('');

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedFilter(e.target.value);
  };

  const handleSort = (key: keyof InterestEntry) => {
    setSortConfig(prev => {
      if (prev?.key === key) {
        if (prev.direction === 'asc') {
          return { key, direction: 'desc' };
        } else if (prev.direction === 'desc') {
          return null;
        }
      }
      return { key, direction: 'asc' };
    });
  };

  const renderSortIcon = (key: keyof InterestEntry) => {
    if (!sortConfig || sortConfig.key !== key) return '⇅';
    return sortConfig.direction === 'asc' ? '↑' : '↓';
  };
  
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
      const stripLeadingArticle = (str: string) =>
        str.replace(/^\s*(a |an |the )/i, '').trim();
      return stripLeadingArticle(aVal).localeCompare(stripLeadingArticle(bVal)) * (direction === 'asc' ? 1 : -1);
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
      .includes(selectedFilter.toLowerCase())
  )

  const filteredItems = data.filter(item =>
    item.product_title.toLowerCase().includes(selectedFilter.toLowerCase()) ||
    item.email.toLowerCase().includes(selectedFilter.toLowerCase()) ||
    item.cr_id?.toLowerCase().includes(selectedFilter.toLowerCase())
  );
/*
  // Export CSV
  const handleExportCSV = () => {
    const headers = ["ID", "Product Title", "ISBN", "Email", "Submitted"];
    const rows = filteredData.map((entry: InterestEntry) => [
      entry.cr_id || "CRN/A",
      decodeHTMLEntities(entry.product_title),
      entry.isbn || "—",
      entry.email,
      new Date(entry.created_at).toLocaleString(),
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
    const tableColumn = ["ID", "Product Title", "ISBN", "Email", "Submitted"];
    const tableRows = filteredData.map((entry: InterestEntry) => [
      entry.cr_id || "CRN/A",
      decodeHTMLEntities(entry.product_title),
      entry.isbn || "—",
      entry.email,
      new Date(entry.created_at).toLocaleString(),
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
  };*/

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold mb-4">Request Service</h1>
      {loading && <p>Loading...</p>}
      {error && <p className="text-red-600 text-sm">Error: {error}</p>}
      {/* Filter and export controls */}
      <div className="print-hidden">
        <ExportButtons
          filteredData={filteredData}
          decodeHTMLEntities={decodeHTMLEntities}
        />
      </div>
      {/* FilterControls and Table */}
      <div className="print-hidden">
        <FilterControls
          selectedFilter={selectedFilter}
          handleFilterChange={handleFilterChange}
        />
      </div>
      <AdminTable
        filteredData={filteredData}
        handleSort={handleSort}
        renderSortIcon={renderSortIcon}
        sortConfig={sortConfig}
        decodeHTMLEntities={decodeHTMLEntities}
      />
    </div>
  )
}


export default AdminDashboard
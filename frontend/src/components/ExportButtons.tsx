import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { InterestEntry } from "../types";

export interface ExportButtonsProps {
  filteredData: InterestEntry[];
  decodeHTMLEntities: (str: string) => string;
}

const decodeHTMLEntities = (str: string): string => {
  const txt = document.createElement("textarea");
  txt.innerHTML = str;
  return txt.value;
};

export default function ExportButtons({ filteredData }: ExportButtonsProps) {
  const handleExportCSV = () => {
    const headers = ["ID", "Product Title", "ISBN", "Email", "Submitted"];
    const rows = filteredData.map((entry) => [
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

  const handleExportPDF = () => {
    const doc = new jsPDF();
    const tableColumn = ["ID", "Product Title", "ISBN", "Email", "Submitted", "Link"];
    const tableRows = filteredData.map((entry) => [
      entry.cr_id || "CRN/A",
      decodeHTMLEntities(entry.product_title),
      entry.isbn || "—",
      entry.email,
      new Date(entry.created_at).toLocaleString(),
    ]);
    autoTable(doc, {
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
    <div className="flex flex-nowrap justify-end w-full mb-[10px] gap-[0.2rem]">
      <button onClick={handleExportCSV} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
        Export CSV
      </button>
      <button onClick={handleExportPDF} className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600">
        Export PDF
      </button>
      <button onClick={handlePrint} className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600">
        🖨️
      </button>
    </div>
  );
}

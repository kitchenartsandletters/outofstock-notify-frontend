import React from 'react';

type InterestEntry = {
  cr_id?: string;
  email: string;
  isbn?: string;
  product_id: number;
  product_title: string;
  created_at: string;
};

interface AdminTableProps {
  filteredData: InterestEntry[];
  handleSort: (key: keyof InterestEntry) => void;
  renderSortIcon: (key: keyof InterestEntry) => string;
  sortConfig: { key: keyof InterestEntry; direction: 'asc' | 'desc' } | null;
  decodeHTMLEntities: (str: string) => string;
}

const AdminTable: React.FC<AdminTableProps> = ({
  filteredData,
  handleSort,
  renderSortIcon,
  sortConfig,
  decodeHTMLEntities,
}) => {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse border border-gray-200 dark:border-gray-700">
        <thead className="bg-gray-100 dark:bg-gray-800">
          <tr>
            <th
              onClick={() => handleSort('cr_id')}
              className={`cursor-pointer border px-4 py-2 dark:border-gray-700 text-left ${
                sortConfig?.key === 'cr_id' ? 'text-green-600 dark:text-green-400' : ''
              }`}
            >
              ID {renderSortIcon('cr_id')}
            </th>
            <th
              onClick={() => handleSort('product_title')}
              className={`cursor-pointer border px-4 py-2 dark:border-gray-700 text-left ${
                sortConfig?.key === 'product_title' ? 'text-green-600 dark:text-green-400' : ''
              }`}
            >
              Product Title {renderSortIcon('product_title')}
            </th>
            <th className="border px-4 py-2 dark:border-gray-700 text-left">ISBN</th>
            <th
              onClick={() => handleSort('email')}
              className={`cursor-pointer border px-4 py-2 dark:border-gray-700 text-left ${
                sortConfig?.key === 'email' ? 'text-green-600 dark:text-green-400' : ''
              }`}
            >
              Email {renderSortIcon('email')}
            </th>
            <th
              onClick={() => handleSort('created_at')}
              className={`cursor-pointer border px-4 py-2 dark:border-gray-700 text-left ${
                sortConfig?.key === 'created_at' ? 'text-green-600 dark:text-green-400' : ''
              }`}
            >
              Created At {renderSortIcon('created_at')}
            </th>
            <th className="border px-4 py-2 dark:border-gray-700 text-left">Link</th>
          </tr>
        </thead>
        <tbody>
          {filteredData.map((entry, index) => (
            <tr key={index} className="even:bg-gray-50 dark:even:bg-gray-700">
              <td className="border px-4 py-2 dark:border-gray-700">{entry.cr_id || 'CRN/A'}</td>
              <td className="border px-4 py-2 dark:border-gray-700">{decodeHTMLEntities(entry.product_title)}</td>
              <td className="border px-4 py-2 dark:border-gray-700">{entry.isbn}</td>
              <td className="border px-4 py-2 dark:border-gray-700">{entry.email}</td>
              <td className="border px-4 py-2 dark:border-gray-700">{new Date(entry.created_at).toLocaleString()}</td>
              <td className="border px-4 py-2 dark:border-gray-700">
                <a
                  href={`https://admin.shopify.com/store/castironbooks/products/${entry.product_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View Product
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default AdminTable;
import React from 'react';

export interface FilterControlsProps {
  selectedFilter: string;
  handleFilterChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  filterOptions: string[];
}

const FilterControls: React.FC<FilterControlsProps> = ({
  selectedFilter,
  handleFilterChange,
  filterOptions,
}) => {
  return (
    <div className="flex flex-wrap items-center gap-4 mb-4">
      <label htmlFor="statusFilter" className="text-sm font-medium text-gray-700 dark:text-gray-300">
        Filter by status:
      </label>
      <select
        id="statusFilter"
        value={selectedFilter}
        onChange={handleFilterChange}
        className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm dark:text-white"
      >
        {filterOptions.map((option) => (
          <option key={option} value={option}>
            {option === 'all'
              ? 'All'
              : option
                  .replace('_', ' ')
                  .replace(/\b\w/g, (c) => c.toUpperCase())}
          </option>
        ))}
      </select>
    </div>
  );
};

export default FilterControls;
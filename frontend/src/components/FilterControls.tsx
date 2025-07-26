import React, { ChangeEvent } from 'react';

export interface FilterControlsProps {
  selectedFilter: string;
  handleFilterChange: (e: ChangeEvent<HTMLInputElement>) => void;
}

const FilterControls: React.FC<FilterControlsProps> = ({
  selectedFilter,
  handleFilterChange,
}) => {
  return (
    <div className="mb-4">
      <input
        type="text"
        placeholder="Filter by title, email or ID..."
        value={selectedFilter}
        onChange={handleFilterChange}
        className="px-4 py-2 border border-gray-300 rounded w-full dark:bg-gray-800 dark:text-white dark:border-gray-600"
      />
    </div>
  );
};

export default FilterControls;
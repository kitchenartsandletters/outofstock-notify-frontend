import { ReactNode } from 'react';

type DashboardHeaderProps = {
  children?: ReactNode;
};

const DashboardHeader = ({ children }: DashboardHeaderProps) => {
  return (
    <div className="flex items-center justify-between mb-6">
      <h1 className="text-3xl font-semibold text-gray-900 dark:text-gray-100">
        Out of Stock Request List
      </h1>
      {children}
    </div>
  );
};

export default DashboardHeader;
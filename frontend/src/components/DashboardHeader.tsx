import { ReactNode } from 'react';

type DashboardHeaderProps = {
  title?: string;
  children?: ReactNode;
};

const DashboardHeader = ({ title, children }: DashboardHeaderProps) => {
  return (
    <div className="flex items-center justify-between">
      {title && (
        <h1 className="text-3xl font-semibold text-gray-900 dark:text-gray-100">
          {title}
        </h1>
      )}
      {children}
    </div>
  );
};

export default DashboardHeader;
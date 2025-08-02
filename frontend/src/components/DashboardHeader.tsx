import { ReactNode } from 'react';

type DashboardHeaderProps = {
  title: string;
};

const DashboardHeader = ({ title }: DashboardHeaderProps) => {
  return (
    <h1 className="text-3xl font-semibold text-gray-900 dark:text-gray-100">
      {title}
    </h1>
  );
};

export default DashboardHeader;
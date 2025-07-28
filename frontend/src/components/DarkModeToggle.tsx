interface DarkModeToggleProps {
  isDarkMode: boolean;
  setIsDarkMode: () => void;
}

const DarkModeToggle = ({ isDarkMode, setIsDarkMode }: DarkModeToggleProps) => {
  return (
    <label className="flex items-center cursor-pointer">
      <span className="mr-2 text-sm text-gray-700 dark:text-gray-200">Dark Mode</span>
      <input
        type="checkbox"
        checked={isDarkMode}
        onChange={setIsDarkMode}
        className="sr-only"
      />
      <div
        className={`w-10 h-5 flex items-center rounded-full p-1 duration-300 ease-in-out
          ${isDarkMode ? 'bg-gray-600' : 'bg-gray-300'}`}
      >
        <div
          className={`bg-white w-4 h-4 rounded-full shadow-md transform duration-300 ease-in-out
            ${isDarkMode ? 'translate-x-5' : ''}`}
        ></div>
      </div>
    </label>
  );
};

export default DarkModeToggle;
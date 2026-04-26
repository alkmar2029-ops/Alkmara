export function SkeletonCard() {
  return (
    <div className="card animate-pulse">
      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-3"></div>
      <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="card p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <div className="animate-pulse min-w-0">
          <div className="bg-gray-50 dark:bg-gray-900 p-4 flex gap-4">
            {Array.from({ length: cols }).map((_, i) => (
              <div key={i} className="h-4 bg-gray-200 dark:bg-gray-700 rounded flex-1"></div>
            ))}
          </div>
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="p-4 border-t border-gray-200 dark:border-gray-800 flex gap-4">
              {Array.from({ length: cols }).map((_, j) => (
                <div key={j} className="h-4 bg-gray-200 dark:bg-gray-700 rounded flex-1"></div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SkeletonPage() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <SkeletonTable />
    </div>
  );
}

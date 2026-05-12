export default function ProfileLoading() {
  return (
    <div className="h-dvh overflow-y-auto">
      <div className="mx-auto max-w-4xl p-6">
        <div className="mb-8">
          <div className="mb-2 h-9 w-32 animate-pulse rounded bg-muted" />
          <div className="h-5 w-56 animate-pulse rounded bg-muted" />
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="h-96 animate-pulse rounded-lg bg-muted" />
          <div className="h-96 animate-pulse rounded-lg bg-muted" />
        </div>
      </div>
    </div>
  );
}

import PublicFrame from '@/components/PublicFrame'

export default function NotFound() {
  return (
    <PublicFrame narrow>
      <div className="card section-header" style={{textAlign: 'center', justifyItems: 'center'}}>
        <p className="eyebrow">404</p>
        <h1 className="headline-md">Page not found</h1>
        <p className="lead">This link may be mistyped, or the meeting type is no longer accepting bookings.</p>
      </div>
    </PublicFrame>
  )
}

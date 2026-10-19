import Link from 'next/link'
export default function Home() { return <main className="container"><h1>Loopin</h1><p>Configure meeting types, connect your calendar and share booking links.</p><nav><Link href="/scheduler/admin">Meeting types & calendar</Link><Link href="/scheduler/admin/bookings">Bookings</Link><Link href="/scheduler/admin/configuration">Configuration & embeds</Link></nav></main> }

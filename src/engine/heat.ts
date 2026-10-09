// Where the ad's taste is strongest (spec.md > D4b, revised in slice 5): Qloo's heatmap tiles rolled up into US metros,
// weighted by tile popularity so empty rural tiles don't dominate. Regions to test = the 2 hottest metros + the coolest
// big metro, so the dashboard shows both where to spend and where to skip.
import type { HeatPoint } from '../qloo/client.ts'

export type Metro = { label: string; query: string; lat: number; lon: number }
export type MetroHeat = { label: string; query: string; heat: number; size: number }

// ponytail: a static table of ~50 US metros (approximate centres); non-US markets fall back to the regions agent.
export const US_METROS: Metro[] = ([
  ['New York, NY', 'New York City', 40.7128, -74.006], ['Los Angeles, CA', 'Los Angeles', 34.0522, -118.2437], ['Chicago, IL', 'Chicago', 41.8781, -87.6298],
  ['Houston, TX', 'Houston', 29.7604, -95.3698], ['Phoenix, AZ', 'Phoenix', 33.4484, -112.074], ['Philadelphia, PA', 'Philadelphia', 39.9526, -75.1652],
  ['San Antonio, TX', 'San Antonio', 29.4241, -98.4936], ['San Diego, CA', 'San Diego', 32.7157, -117.1611], ['Dallas, TX', 'Dallas', 32.7767, -96.797],
  ['Austin, TX', 'Austin', 30.2672, -97.7431], ['San Jose, CA', 'San Jose', 37.3382, -121.8863], ['San Francisco, CA', 'San Francisco', 37.7749, -122.4194],
  ['Jacksonville, FL', 'Jacksonville', 30.3322, -81.6557], ['Columbus, OH', 'Columbus, Ohio', 39.9612, -82.9988], ['Charlotte, NC', 'Charlotte', 35.2271, -80.8431],
  ['Indianapolis, IN', 'Indianapolis', 39.7684, -86.1581], ['Seattle, WA', 'Seattle', 47.6062, -122.3321], ['Denver, CO', 'Denver', 39.7392, -104.9903],
  ['Washington, DC', 'Washington, D.C.', 38.9072, -77.0369], ['Boston, MA', 'Boston', 42.3601, -71.0589], ['Nashville, TN', 'Nashville', 36.1627, -86.7816],
  ['Detroit, MI', 'Detroit', 42.3314, -83.0458], ['Portland, OR', 'Portland, Oregon', 45.5152, -122.6784], ['Las Vegas, NV', 'Las Vegas', 36.1699, -115.1398],
  ['Memphis, TN', 'Memphis', 35.1495, -90.049], ['Louisville, KY', 'Louisville', 38.2527, -85.7585], ['Baltimore, MD', 'Baltimore', 39.2904, -76.6122],
  ['Milwaukee, WI', 'Milwaukee', 43.0389, -87.9065], ['Albuquerque, NM', 'Albuquerque', 35.0844, -106.6504], ['Tucson, AZ', 'Tucson', 32.2226, -110.9747],
  ['Sacramento, CA', 'Sacramento', 38.5816, -121.4944], ['Kansas City, MO', 'Kansas City', 39.0997, -94.5786], ['Atlanta, GA', 'Atlanta', 33.749, -84.388],
  ['Miami, FL', 'Miami', 25.7617, -80.1918], ['Raleigh, NC', 'Raleigh', 35.7796, -78.6382], ['Minneapolis, MN', 'Minneapolis', 44.9778, -93.265],
  ['New Orleans, LA', 'New Orleans', 29.9511, -90.0715], ['Tampa, FL', 'Tampa', 27.9506, -82.4572], ['Orlando, FL', 'Orlando', 28.5383, -81.3792],
  ['Cleveland, OH', 'Cleveland', 41.4993, -81.6944], ['Pittsburgh, PA', 'Pittsburgh', 40.4406, -79.9959], ['St. Louis, MO', 'St. Louis', 38.627, -90.1994],
  ['Cincinnati, OH', 'Cincinnati', 39.1031, -84.512], ['Salt Lake City, UT', 'Salt Lake City', 40.7608, -111.891], ['Oklahoma City, OK', 'Oklahoma City', 35.4676, -97.5164],
  ['Richmond, VA', 'Richmond, Virginia', 37.5407, -77.436], ['Birmingham, AL', 'Birmingham, Alabama', 33.5186, -86.8104], ['Honolulu, HI', 'Honolulu', 21.3069, -157.8583],
  ['Boise, ID', 'Boise', 43.615, -116.2023], ['Omaha, NE', 'Omaha', 41.2565, -95.9345], ['Madison, WI', 'Madison, Wisconsin', 43.0731, -89.4012],
  ['Asheville, NC', 'Asheville', 35.5951, -82.5515],
] as const).map(([label, query, lat, lon]) => ({ label, query, lat, lon }))

const km = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const r = Math.PI / 180
  const h = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLon - aLon) * r) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

// Popularity-weighted mean affinity of the tiles within `radius` km of each metro centre; metros with no tiles are skipped.
export function metroHeat(points: HeatPoint[], metros = US_METROS, radius = 40): MetroHeat[] {
  return metros
    .map((m) => {
      const near = points.filter((p) => km(m.lat, m.lon, p.lat, p.lon) <= radius)
      const size = near.reduce((s, p) => s + p.popularity, 0)
      const heat = size ? near.reduce((s, p) => s + p.affinity * p.popularity, 0) / size : NaN
      return { label: m.label, query: m.query, heat, size }
    })
    .filter((m) => !isNaN(m.heat))
    .sort((a, b) => b.heat - a.heat)
}

// The 2 hottest metros, plus the coolest of the 15 biggest (by summed tile popularity) as the contrast.
export function pickRegions(ranked: MetroHeat[], hot = 2): { hot: MetroHeat[]; cool: MetroHeat | null } {
  const top = ranked.slice(0, hot)
  const big = [...ranked].sort((a, b) => b.size - a.size).slice(0, 15).filter((m) => !top.includes(m))
  const cool = big.sort((a, b) => a.heat - b.heat)[0] ?? null
  return { hot: top, cool }
}

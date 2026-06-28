import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

import {
  searchFilm,
  getFilmDetails,
  getPersonFilmography,
  getUpcomingFilms,
  getReleasedFilmsForComps,
} from '../services/tmdb.js';

const hr = (label) => {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${label}`);
  console.log('─'.repeat(60));
};

/* 1 — searchFilm */
hr('1. searchFilm("Spider-Man Brand New Day")');
const searchResults = await searchFilm('Spider-Man Brand New Day');
if (!searchResults) { console.error('searchFilm returned null'); process.exit(1); }
searchResults.slice(0, 3).forEach((r, i) =>
  console.log(`  [${i + 1}] tmdb_id=${r.tmdb_id}  "${r.title}"  (${r.release_date ?? 'TBD'})`)
);

/* 2 — getFilmDetails */
const firstId = searchResults[0]?.tmdb_id;
hr(`2. getFilmDetails(${firstId})`);
const details = await getFilmDetails(firstId);
if (!details) { console.error('getFilmDetails returned null'); process.exit(1); }
console.log(`  title:       ${details.title}`);
console.log(`  market:      ${details.market}`);
console.log(`  status:      ${details.status}`);
console.log(`  mpaa_rating: ${details.mpaa_rating ?? 'n/a'}`);
console.log(`  budget:      $${(details.budget / 1e6).toFixed(1)}M  (source: ${details.budget_source ?? 'none'})`);
console.log(`  genres:      ${details.genres.join(', ')}`);
console.log(`  director:    ${details.director?.name ?? 'n/a'}  (id: ${details.director?.tmdb_person_id ?? 'n/a'})`);
console.log(`  cast_top5:   ${details.cast_top5.map((c) => c.name).join(', ')}`);
console.log(`  trailer_url: ${details.trailer_url ?? 'none'}`);

/* 3 — getPersonFilmography */
const directorId = details.director?.tmdb_person_id;
hr(`3. getPersonFilmography(${directorId} — ${details.director?.name ?? '?'})`);
const filmography = directorId ? await getPersonFilmography(directorId) : null;
if (!filmography) {
  console.log('  No director id or filmography returned null');
} else {
  const directed = filmography.as_crew
    .filter((f) => f.release_date)
    .sort((a, b) => b.release_date.localeCompare(a.release_date))
    .slice(0, 5);
  directed.forEach((f) =>
    console.log(
      `  "${f.title}" (${f.release_date.slice(0, 4)})  revenue=$${(f.revenue / 1e6).toFixed(1)}M`
    )
  );
  if (directed.length === 0) console.log('  No directed films found yet');
}

/* 4 — getUpcomingFilms("hollywood") */
hr('4. getUpcomingFilms("hollywood")');
const upcoming = await getUpcomingFilms('hollywood');
if (!upcoming) { console.error('getUpcomingFilms returned null'); }
else {
  upcoming.slice(0, 5).forEach((f) =>
    console.log(`  "${f.title}"  (${f.release_date ?? 'TBD'})  popularity=${f.popularity.toFixed(1)}`)
  );
}

/* 5 — getReleasedFilmsForComps([28], "hollywood", 150_000_000) */
hr('5. getReleasedFilmsForComps([28 = Action], "hollywood", $150M budget)');
const comps = await getReleasedFilmsForComps([28], 'hollywood', 150_000_000);
if (!comps) { console.error('getReleasedFilmsForComps returned null'); }
else {
  comps.slice(0, 5).forEach((f) =>
    console.log(
      `  "${f.title}" (${f.release_date?.slice(0, 4) ?? '?'})  revenue=$${(f.revenue / 1e6).toFixed(1)}M`
    )
  );
}

console.log('\n✅ All tests complete\n');

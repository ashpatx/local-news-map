/* ============================================================
   wp-content/themes/twentytwentyfive/js/map.js
   ============================================================ */

document.addEventListener( 'DOMContentLoaded', () => {

  // ── DOM refs ──────────────────────────────────────────────
  const mapEl       = document.getElementById( 'map' );
  const articleList = document.getElementById( 'articleList' );
  const heading     = document.getElementById( 'articlesHeading' );
  const cityInput   = document.getElementById( 'cityInput' );
  const cityButton  = document.getElementById( 'cityButton' );
  const resetButton = document.getElementById( 'resetButton' );

  if ( !mapEl || !articleList || !cityInput || !cityButton ) return;

  // ── Leaflet map ───────────────────────────────────────────
  const map = L.map( 'map' ).setView( [ 39.5, -98.35 ], 4 );

  L.tileLayer( 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 18
  } ).addTo( map );

  const markersCluster = L.markerClusterGroup();
  map.addLayer( markersCluster );

  let data = [];

  // ── Config passed in by wp_localize_script ────────────────
  const jsonUrl = ( typeof NewsMapConfig !== 'undefined' ) ? NewsMapConfig.jsonUrl : '/wp-content/uploads/news.json';
  const ajaxUrl = ( typeof NewsMapConfig !== 'undefined' ) ? NewsMapConfig.ajaxUrl : '/wp-admin/admin-ajax.php';

  // ── Load station JSON ─────────────────────────────────────
  fetch( jsonUrl )
    .then( res => {
      if ( !res.ok ) throw new Error( 'JSON ' + res.status );
      return res.json();
    } )
    .then( json => {
      data = json;
      data.forEach( station => addMarker( station ) );
    } )
    .catch( err => console.error( '[news-map] JSON load failed —', err ) );

  // ── Add marker ────────────────────────────────────────────
  function addMarker( station ) {
    const marker = L.marker( [ station.lat, station.lng ] )
      .bindPopup(
        '<strong>' + station.name + '</strong><br>' +
        '<small style="color:#666;">' + station.coverage + '</small><br>' +
        '<a href="' + station.website + '" target="_blank" rel="noopener">Visit site →</a>'
      );

    marker.on( 'click', () => fetchArticles( station ) );
    markersCluster.addLayer( marker );
  }

  // ============================================================
  // FETCH FEED — calls our own WordPress endpoint, no third-party proxy
  // ============================================================
  async function fetchFeedXML( feedUrl ) {
    console.log( '[news-map] fetching feed via WP endpoint:', feedUrl );

    // POST to admin-ajax.php — WordPress handles the actual fetch server-side
    const body = new URLSearchParams();
    body.append( 'action', 'newsmapFetchRss' );
    body.append( 'url',    feedUrl );

    const res = await fetch( ajaxUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString()
    } );

    const xmlText = await res.text();

    // Log whether it came from cache or was freshly fetched
    const cacheStatus = res.headers.get( 'X-NewsMap-Cache' ) || 'unknown';
    console.log( '[news-map] WP endpoint responded — status:', res.status,
                 '| cache:', cacheStatus, '| body length:', xmlText.length );

    if ( !res.ok || !xmlText || xmlText.length < 50 ) {
      throw new Error( 'WP endpoint returned status ' + res.status + ' (body: ' + xmlText.slice( 0, 200 ) + ')' );
    }

    return xmlText;
  }

  // ============================================================
  // PARSE — handles both RSS 2.0 (<item>) and Atom (<entry>)
  // ============================================================
  function parseArticles( xmlString ) {
    const parser = new DOMParser();
    const xml    = parser.parseFromString( xmlString, 'text/xml' );

    if ( xml.querySelector( 'parsererror' ) ) {
      console.error( '[news-map] XML parsererror. First 500 chars:', xmlString.slice( 0, 500 ) );
      throw new Error( 'XML parse failed' );
    }

    // ── RSS 2.0 ──
    const items = xml.querySelectorAll( 'item' );
    if ( items.length ) {
      console.log( '[news-map] RSS 2.0 — ' + items.length + ' items' );
      return Array.from( items ).slice( 0, 2 ).map( item => ( {
        title: getText( item, 'title' ),
        link:  getRssLink( item ),
        desc:  getText( item, 'description' )
      } ) );
    }

    // ── Atom ──
    const entries = xml.querySelectorAll( 'entry' );
    if ( entries.length ) {
      console.log( '[news-map] Atom — ' + entries.length + ' entries' );
      return Array.from( entries ).slice( 0, 2 ).map( entry => ( {
        title: getText( entry, 'title' ),
        link:  getAtomLink( entry ),
        desc:  getText( entry, 'summary' ) || getText( entry, 'content' )
      } ) );
    }

    console.warn( '[news-map] No <item> or <entry>. Root tag:', xml.documentElement.tagName );
    throw new Error( 'No articles in feed' );
  }

  // ── Helpers ───────────────────────────────────────────────

  function getText( parent, tag ) {
    const el = parent.getElementsByTagName( tag )[ 0 ];
    return el ? ( el.textContent || '' ).trim() : '';
  }

  // RSS <link> is awkward — walk direct child nodes
  function getRssLink( item ) {
    const nodes = item.childNodes;
    for ( let i = 0; i < nodes.length; i++ ) {
      if ( nodes[ i ].nodeName === 'link' ) {
        const txt = ( nodes[ i ].textContent || '' ).trim();
        if ( txt.startsWith( 'http' ) ) return txt;
      }
    }
    const guid = getText( item, 'guid' );
    if ( guid.startsWith( 'http' ) ) return guid;
    return '#';
  }

  // Atom <link> uses href attribute
  function getAtomLink( entry ) {
    const links = entry.getElementsByTagName( 'link' );
    for ( let i = 0; i < links.length; i++ ) {
      if ( ( links[ i ].getAttribute( 'rel' ) || 'alternate' ) === 'alternate' ) {
        const href = links[ i ].getAttribute( 'href' );
        if ( href ) return href;
      }
    }
    if ( links.length && links[ 0 ].getAttribute( 'href' ) ) {
      return links[ 0 ].getAttribute( 'href' );
    }
    return '#';
  }

  function cleanText( raw, max ) {
    const text = ( raw || '' ).replace( /<[^>]*>/g, ' ' ).replace( /\s+/g, ' ' ).trim();
    return text.length > max ? text.slice( 0, max - 3 ) + '…' : text;
  }

  // ── Main: fetch → parse → render ──────────────────────────
  async function fetchArticles( station ) {
    if ( heading ) heading.style.display = 'block';
    articleList.innerHTML = '<li style="color:#999; font-style:italic;">Loading…</li>';

    if ( !station.rss ) {
      articleList.innerHTML = '<li style="color:#999;">No RSS feed available.</li>';
      return;
    }

    console.log( '[news-map] ── fetching articles for:', station.name );

    try {
      const xmlString = await fetchFeedXML( station.rss );
      const articles  = parseArticles( xmlString );

      articleList.innerHTML = '';

      articles.forEach( article => {
        const li  = document.createElement( 'li' );
        li.style.cssText = 'padding:14px 0; border-bottom:1px solid #eee; line-height:1.45;';

        const desc = cleanText( article.desc, 200 );
        li.innerHTML =
          '<a href="' + article.link + '" target="_blank" rel="noopener" ' +
          'style="font-weight:600; color:#111; text-decoration:none; font-size:16px;">' +
          article.title + '</a>' +
          ( desc ? '<p style="margin:6px 0 0; color:#666; font-size:14px; line-height:1.5;">' + desc + '</p>' : '' );

        articleList.appendChild( li );
      } );

      console.log( '[news-map] ── rendered', articles.length, 'article(s) for', station.name );

    } catch ( err ) {
      console.error( '[news-map] ── FAILED for', station.name, '—', err );
      articleList.innerHTML =
        '<li style="color:#c44;">Could not load articles for <strong>' +
        station.name + '</strong>. The feed may be unavailable.</li>';
    }
  }

  // ── Search ────────────────────────────────────────────────
  function searchLocation( query ) {
    clearArticles();
    const q       = query.toLowerCase();
    const matches = data.filter( s => s.city_state.toLowerCase().includes( q ) );

    if ( !matches.length ) {
      alert( 'No local newsrooms found for "' + query + '". Try a different city or state.' );
      return;
    }

    markersCluster.clearLayers();
    matches.forEach( s => addMarker( s ) );
    map.fitBounds( L.latLngBounds( matches.map( s => [ s.lat, s.lng ] ) ), { padding: [ 40, 40 ] } );
  }

  // ── Reset ─────────────────────────────────────────────────
  function resetMarkers() {
    clearArticles();
    markersCluster.clearLayers();
    data.forEach( s => addMarker( s ) );
    map.setView( [ 39.5, -98.35 ], 4 );
    cityInput.value = '';
  }

  function clearArticles() {
    articleList.innerHTML = '';
    if ( heading ) heading.style.display = 'none';
  }

  // ── Listeners ─────────────────────────────────────────────
  cityButton.addEventListener( 'click', () => {
    const val = cityInput.value.trim();
    if ( val ) searchLocation( val );
  } );

  cityInput.addEventListener( 'keydown', ( e ) => {
    if ( e.key === 'Enter' ) {
      const val = cityInput.value.trim();
      if ( val ) searchLocation( val );
    }
  } );

  if ( resetButton ) resetButton.addEventListener( 'click', resetMarkers );

} );

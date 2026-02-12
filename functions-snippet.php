
// ============================================================
// Local News Map — Leaflet + MarkerCluster + map.js
// ============================================================
add_action( 'wp_enqueue_scripts', function () {

	// ── Leaflet ─────────────────────────────────────────────
	wp_enqueue_style(
		'leaflet-css',
		'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
		array(),
		'1.9.4'
	);
	wp_enqueue_script(
		'leaflet-js',
		'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
		false,
		'1.9.4',
		true
	);

	// ── MarkerCluster ───────────────────────────────────────
	wp_enqueue_style(
		'leaflet-markercluster-css',
		'https://unpkg.com/leaflet.markercluster@1.1.0/dist/MarkerCluster.css',
		array( 'leaflet-css' ),
		'1.1.0'
	);
	wp_enqueue_style(
		'leaflet-markercluster-default-css',
		'https://unpkg.com/leaflet.markercluster@1.1.0/dist/MarkerCluster.Default.css',
		array( 'leaflet-markercluster-css' ),
		'1.1.0'
	);
	wp_enqueue_script(
		'leaflet-markercluster-js',
		'https://unpkg.com/leaflet.markercluster@1.1.0/dist/leaflet.markercluster.js',
		array( 'leaflet-js' ),
		'1.1.0',
		true
	);

	// ── map.js ──────────────────────────────────────────────
	wp_enqueue_script(
		'news-map',
		get_stylesheet_directory_uri() . '/js/map.js',
		array( 'leaflet-markercluster-js' ),
		'1.0.0',
		true
	);

	// ── Pass config vars to JS ──────────────────────────────
	//    jsonUrl  — path to news.json (subfolder-safe)
	//    ajaxUrl  — WordPress admin-ajax.php (our server-side RSS endpoint)
	$uploads = wp_upload_dir();
	wp_localize_script(
		'news-map',
		'NewsMapConfig',
		array(
			'jsonUrl' => $uploads[ 'baseurl' ] . '/news.json',
			'ajaxUrl' => admin_url( 'admin-ajax.php' ),
		)
	);

} );


// ============================================================
// Server-side RSS fetch + cache endpoint
// ============================================================
// Flow:
//   JS  →  POST admin-ajax.php  action=newsmapFetchRss  url=<feedurl>
//   PHP →  check transient cache (6 hrs)
//          if miss: wp_remote_get() the feed, cache it
//          echo raw XML back
//   JS  →  parses the XML exactly like before
// ============================================================

// Register for both logged-in AND logged-out visitors
add_action( 'wp_ajax_newsmapFetchRss',        'newsmapFetchRss' );
add_action( 'wp_ajax_nopriv_newsmapFetchRss', 'newsmapFetchRss' );

function newsmapFetchRss() {

	// ── Validate input ──────────────────────────────────────
	$feedUrl = isset( $_POST['url'] ) ? sanitize_text_field( $_POST['url'] ) : '';

	if ( empty( $feedUrl ) || ! filter_var( $feedUrl, FILTER_VALIDATE_URL ) ) {
		wp_die( 'Invalid URL', '', array( 'response' => 400 ) );
	}

	// Only http / https — block ftp, file://, etc.
	$parsed = parse_url( $feedUrl );
	if ( ! in_array( $parsed['scheme'], array( 'http', 'https' ), true ) ) {
		wp_die( 'Invalid scheme', '', array( 'response' => 400 ) );
	}

	// ── Transient cache check ───────────────────────────────
	// Key limit is 45 chars. "newsmap_rss_" (12) + md5 (32) = 44. Perfect.
	$cacheKey = 'newsmap_rss_' . md5( $feedUrl );
	$cached   = get_transient( $cacheKey );

	if ( false !== $cached ) {
		header( 'Content-Type: text/xml; charset=UTF-8' );
		header( 'X-NewsMap-Cache: hit' );
		echo $cached;
		wp_die();
	}

	// ── Cache miss — fetch live from the source ─────────────
	$response = wp_remote_get( $feedUrl, array(
		'timeout' => 15,
		'headers' => array(
			'Accept' => 'application/xml, text/xml, application/rss+xml, application/atom+xml',
		),
		'sslverify' => true,
	) );

	if ( is_wp_error( $response ) ) {
		wp_die( 'Fetch error: ' . $response->get_error_message(), '', array( 'response' => 502 ) );
	}

	$code = wp_remote_retrieve_response_code( $response );
	if ( $code < 200 || $code >= 300 ) {
		wp_die( 'Feed returned HTTP ' . $code, '', array( 'response' => 502 ) );
	}

	$body = wp_remote_retrieve_body( $response );
	if ( empty( $body ) ) {
		wp_die( 'Empty feed body', '', array( 'response' => 502 ) );
	}

	// ── Cache for 6 hours ───────────────────────────────────
	set_transient( $cacheKey, $body, 6 * HOUR_IN_SECONDS );

	// ── Return XML to browser ───────────────────────────────
	header( 'Content-Type: text/xml; charset=UTF-8' );
	header( 'X-NewsMap-Cache: miss' );
	echo $body;
	wp_die();
}

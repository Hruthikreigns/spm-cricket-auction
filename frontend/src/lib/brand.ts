/**
 * Application branding.
 *
 * These belong to the product, not to any one league, so they live in code and
 * ship with the build rather than being uploaded through the admin panel. A
 * league can still have its own mark, poster and sponsor credit — those sit in
 * Setup → Artwork and appear alongside this, not instead of it.
 */

export const APP_NAME = 'SPM Cricket Auction'

/** Split for the two-tone wordmark in the header. */
export const APP_NAME_PARTS = { lead: 'SPM', rest: 'Cricket Auction' }

export const BANNER = {
  src: '/brand/banner.jpg',
  // Phones get the smaller file; the browser picks by viewport width.
  srcSet: '/brand/banner-small.jpg 800w, /brand/banner.jpg 1600w',
  width: 1600,
  height: 800,
  // The artwork carries its own title, so it is decorative rather than
  // informative — the page heading below it says the same thing to a screen
  // reader, and repeating it would be noise.
  alt: '',
}

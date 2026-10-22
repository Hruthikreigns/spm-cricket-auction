/**
 * GSAP + ScrollTrigger, fetched after first paint. Only scroll-scrubbed
 * effects use it, and none of them are needed to read the page.
 */
let loading: Promise<typeof import('gsap')['gsap']> | null = null

export function loadGsap() {
  loading ??= Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(([g, st]) => {
    g.gsap.registerPlugin(st.ScrollTrigger)
    return g.gsap
  })
  return loading
}

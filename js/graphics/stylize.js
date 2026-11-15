/* Stylize: gives every lit surface in the 3D world the same painted look,
   without touching the code that builds them.

   three.js assembles its shaders from named chunks; the ones below are
   adjusted once, before anything is drawn, so houses, trees, terrain, props
   and everything placed with the map editor share:

   - a painted palette: strong colours are calmed and lifted toward soft,
     milky mid-tones, with broad warm and cool patches and smaller brush dabs;
   - soft daylight: a short, smooth step from light to shade;
   - painted surface detail: shingles, stonework, brick, timber grain, plaster
     and rock, chosen per part (see the surface kinds below);
   - a rim of sky light along edges facing away from the camera;
   - windows and lamps that glow after dark (see NIGHT_GLOW);
   - rain-darkened surfaces, and snow that settles on whatever faces the sky.

   The whole scene is also written in display (sRGB) colours, so it can be
   drawn into an off-screen target for the fog, bloom and colour grade in
   postfx.js and look exactly as it would on screen. */
(function (G) {
  'use strict';
  if (typeof THREE === 'undefined' || !THREE.ShaderChunk) return;
  const SC = THREE.ShaderChunk;

  /* Values shared by every lit material. They are typed arrays on purpose:
     three.js copies numbers and colours per material but keeps arrays by
     reference, so updating these updates the whole world.
       style: [night 0..1, wetness 0..1 (or -snow cover), time (s), rim strength]
       glow:  colour of lit windows and lamps (linear rgb) and its strength */
  const style = new Float32Array([0, 0, 0, 1]);
  const glow = new Float32Array([1.0, 0.62, 0.26, 0]);
  for (const id of ['physical', 'standard']) {
    const lib = THREE.ShaderLib[id];
    if (lib) { lib.uniforms.uStyle = { value: style }; lib.uniforms.uGlow = { value: glow }; }
  }

  // Vertex colours that light up at night (authored hex colours, compared in linear space).
  const NIGHT_GLOW = ['#a8dcff', '#ffe9a8', '#fff3a0'];
  const key = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`; };

  // Everything is output in display colours, on screen or off.
  SC.encodings_fragment = 'gl_FragColor = LinearTosRGB( gl_FragColor );';

  // Soft toon step for direct light.
  SC.lights_physical_pars_fragment = SC.lights_physical_pars_fragment.replace(
    'float dotNL = saturate( dot( geometry.normal, directLight.direction ) );\n\tvec3 irradiance = dotNL * directLight.color;',
    `float dotNLraw = dot( geometry.normal, directLight.direction );
	float dotNL = mix( saturate( dotNLraw ), smoothstep( -0.16, 0.42, dotNLraw ) * 0.84 + 0.16 * saturate( dotNLraw ), 0.85 );
	vec3 irradiance = dotNL * directLight.color;`);

  // Painted surfaces are matte: keep highlights soft, so smooth shapes don't sparkle at grazing angles.
  for (const id of ['physical', 'standard']) {
    const lib = THREE.ShaderLib[id];
    if (lib) lib.fragmentShader = lib.fragmentShader.replace(
      'vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;',
      'vec3 totalSpecular = min( reflectedLight.directSpecular + reflectedLight.indirectSpecular, vec3( 0.45 ) ) * 0.7;');
  }

  /* Surface kinds. Geometry built with Utils.mergeParts carries a per-vertex "kind" (see KINDS there):
     plaster, shingles, wood, masonry, brick, thatch or natural rock. The pattern is drawn here from the
     fragment's world position, so nothing needs texture coordinates and every house, fence, tower and
     boulder, including map-editor objects, gets painted detail. It fades out with distance. */
  SC.color_pars_vertex += '\n#ifdef STANDARD\n\tattribute float wmKind;\n\tvarying float vWmKind;\n#endif';
  SC.color_vertex += '\n#ifdef STANDARD\n\tvWmKind = wmKind;\n#endif';
  SC.color_pars_fragment += '\n#ifdef STANDARD\n\tvarying float vWmKind;\n#endif';

  SC.emissivemap_pars_fragment += `
#ifdef STANDARD
	uniform vec4 uStyle;
	uniform vec4 uGlow;
	float wmHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
	float wmNoise( vec2 p ) {
		vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
		return mix( mix( wmHash( i ), wmHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( wmHash( i + vec2( 0.0, 1.0 ) ), wmHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
	}
#endif`;

  SC.emissivemap_fragment += `
#ifdef STANDARD
	{
		// World position of this fragment (the view matrix is a rotation plus a move).
		vec3 wmPos = cameraPosition - vViewPosition * mat3( viewMatrix );
		vec3 wmN = normalize( normal * mat3( viewMatrix ) );
		// A painted palette: strong colours are calmed and lifted toward a soft, milky mid-tone, like gouache.
		float wmL = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
		diffuseColor.rgb = mix( vec3( wmL ), diffuseColor.rgb, 0.84 ) * 0.86 + vec3( 0.064, 0.056, 0.052 );
		// Brush work: broad warm and cool patches, then smaller dabs stretched along the surface.
		vec2 wmUv = abs( wmN.y ) > 0.6 ? wmPos.xz : ( abs( wmN.x ) > abs( wmN.z ) ? wmPos.zy : wmPos.xy );
		float wmWarm = wmNoise( wmUv * 0.11 + 3.7 ), wmCool = wmNoise( wmUv * 0.17 - 11.3 );
		float wmB = wmNoise( wmUv * vec2( 0.9, 0.42 ) ) * 0.55 + wmNoise( wmUv * vec2( 2.6, 1.3 ) + 17.0 ) * 0.45;
		diffuseColor.rgb *= 0.87 + 0.26 * wmB;
		diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.10, 1.03, 0.84 ), smoothstep( 0.45, 0.85, wmWarm ) * 0.75 );
		diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.90, 0.98, 1.12 ), smoothstep( 0.5, 0.9, wmCool ) * 0.6 );
		float wmK = floor( vWmKind + 0.5 );
		if ( wmK > 0.5 ) {
			float wmFade = 1.0 - smoothstep( 34.0, 90.0, length( vViewPosition ) );
			float wmHl = length( wmN.xz );
			vec2 wmHd = wmHl > 0.001 ? wmN.xz / wmHl : vec2( 0.0, 1.0 );
			float wmAlong = dot( wmPos.xz, vec2( -wmHd.y, wmHd.x ) );                       // sideways along the surface
			bool wmFlat = abs( wmN.y ) > 0.92;
			vec2 wmP = wmFlat ? wmPos.xz : vec2( wmAlong, wmPos.y / max( wmHl, 0.3 ) );        // (sideways, up the surface)
			float wmM = 1.0;
			if ( wmK < 1.5 ) {                                    // plaster: clouds and faint trowel strokes
				wmM = 0.93 + 0.10 * wmNoise( wmP * 1.7 ) + 0.06 * wmNoise( wmP * vec2( 0.7, 7.0 ) );
			} else if ( wmK < 2.5 ) {                             // shingles: overlapping rows, each tile its own tone
				vec2 q = wmP * vec2( 2.2, 2.7 ); float row = floor( q.y ); q.x += mod( row, 2.0 ) * 0.5;
				vec2 f = fract( q );
				wmM = ( 0.88 + 0.24 * wmHash( vec2( floor( q.x ), row ) ) ) * mix( 1.0, 0.66, smoothstep( 0.78, 1.0, f.y ) )
					* mix( 1.0, 0.84, smoothstep( 0.43, 0.5, abs( f.x - 0.5 ) ) ) * ( 1.0 + 0.12 * smoothstep( 0.16, 0.0, f.y ) );
			} else if ( wmK < 3.5 ) {                             // wood: grain and plank seams
				vec2 q = wmFlat ? wmPos.xz : vec2( wmAlong, wmPos.y );
				wmM = 0.88 + 0.24 * ( wmNoise( q * vec2( 9.0, 0.7 ) ) * 0.6 + wmNoise( q * vec2( 23.0, 1.5 ) + 5.0 ) * 0.4 );
				float pl = fract( q.x * 2.3 ); wmM *= mix( 0.78, 1.0, smoothstep( 0.0, 0.07, min( pl, 1.0 - pl ) ) );
			} else if ( wmK < 5.5 ) {                             // masonry (4) and brick (5): staggered blocks with mortar
				vec2 q = wmP * ( wmK < 4.5 ? vec2( 1.3, 2.4 ) : vec2( 2.6, 5.2 ) ); float row = floor( q.y );
				q.x += wmK < 4.5 ? wmHash( vec2( row, 3.0 ) ) : mod( row, 2.0 ) * 0.5;
				vec2 f = fract( q );
				float mort = smoothstep( 0.0, 0.07, min( f.x, 1.0 - f.x ) ) * smoothstep( 0.0, 0.11, min( f.y, 1.0 - f.y ) );
				wmM = ( 0.88 + 0.24 * wmHash( vec2( floor( q.x ), row ) ) ) * mix( 0.7, 1.0, mort ) * ( 1.0 + 0.08 * smoothstep( 0.72, 1.0, f.y ) * mort );
			} else if ( wmK < 6.5 ) {                             // thatch: fine strands in layers
				wmM = ( 0.84 + 0.3 * wmNoise( wmP * vec2( 15.0, 1.3 ) ) ) * mix( 0.8, 1.0, smoothstep( 0.0, 0.3, fract( wmP.y * 1.5 ) ) );
			} else {                                              // natural rock: mottling and cracks
				float c = abs( wmNoise( wmPos.xz * 1.4 + wmPos.y * 0.8 ) - wmNoise( wmPos.zx * 1.2 - wmPos.y * 0.9 + 4.0 ) );
				wmM = ( 0.9 + 0.18 * wmNoise( wmPos.xy * 2.1 + wmPos.z ) ) * mix( 0.76, 1.0, smoothstep( 0.0, 0.06, c ) );
			}
			diffuseColor.rgb *= mix( 1.0, wmM, wmFade );
		}
		// Rain darkens and cools what it soaks.
		diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.72, 0.76, 0.84 ), max( uStyle.y, 0.0 ) * clamp( wmN.y * 0.6 + 0.6, 0.0, 1.0 ) );
		// Snow settles on whatever faces the sky (uStyle.y below zero means snow).
		diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.86, 0.90, 0.95 ), max( -uStyle.y, 0.0 ) * smoothstep( 0.45, 0.9, wmN.y ) * ( 0.55 + 0.3 * wmB ) );
		// A rim of sky light on edges that turn away from the camera.
		float wmRim = pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 3.0 );
		totalEmissiveRadiance += diffuseColor.rgb * wmRim * 0.22 * uStyle.w * ( 0.4 + 0.6 * saturate( wmN.y + 0.3 ) );
		#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
			// Windows and lamp glass shine after dark.
			float wmKey = 0.0;
			${NIGHT_GLOW.map((h) => `wmKey = max( wmKey, 1.0 - step( 0.0012, dot( vColor.rgb - ${key(h)}, vColor.rgb - ${key(h)} ) ) );`).join('\n\t\t\t')}
			float wmFlick = 0.92 + 0.08 * sin( uStyle.z * 9.0 + wmPos.x * 3.1 + wmPos.z * 1.7 );
			totalEmissiveRadiance += uGlow.rgb * uGlow.a * wmKey * wmFlick;
			diffuseColor.rgb = mix( diffuseColor.rgb, uGlow.rgb, wmKey * min( 1.0, uGlow.a ) * 0.7 );
		#endif
	}
#endif`;

  G.Stylize = { style, glow };
})(window.G = window.G || {});

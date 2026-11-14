/* Stylize: gives every lit surface in the 3D world the same painted look,
   without touching the code that builds them.

   three.js assembles its shaders from named chunks; the ones below are
   adjusted once, before anything is drawn, so houses, trees, terrain, props
   and everything placed with the map editor share:

   - soft "toon" daylight: a short, smooth step from light to shade instead
     of a long gradient, like hand-painted textures;
   - brush mottling: a little large-scale colour variation across surfaces;
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
	float dotNL = mix( saturate( dotNLraw ), smoothstep( -0.10, 0.34, dotNLraw ) * 0.86 + 0.14 * saturate( dotNLraw ), 0.8 );
	vec3 irradiance = dotNL * directLight.color;`);

  // Painted surfaces are matte: keep highlights soft, so smooth shapes don't sparkle at grazing angles.
  for (const id of ['physical', 'standard']) {
    const lib = THREE.ShaderLib[id];
    if (lib) lib.fragmentShader = lib.fragmentShader.replace(
      'vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;',
      'vec3 totalSpecular = min( reflectedLight.directSpecular + reflectedLight.indirectSpecular, vec3( 0.45 ) ) * 0.7;');
  }

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
		// Brush mottling: two sizes of soft noise, projected along the surface.
		vec2 wmUv = abs( wmN.y ) > 0.6 ? wmPos.xz : ( abs( wmN.x ) > abs( wmN.z ) ? wmPos.zy : wmPos.xy );
		float wmB = wmNoise( wmUv * 0.55 ) * 0.6 + wmNoise( wmUv * 2.3 + 17.0 ) * 0.4;
		diffuseColor.rgb *= 0.90 + 0.20 * wmB;
		diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.04, 1.0, 0.94 ), wmB );
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

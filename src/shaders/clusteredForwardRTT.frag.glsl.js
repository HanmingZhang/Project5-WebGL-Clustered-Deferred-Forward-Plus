export default function(params) {
  return `

  #version 100
  #extension GL_EXT_draw_buffers: enable
  precision highp float;

  uniform sampler2D u_colmap;
  uniform sampler2D u_normap;
  uniform sampler2D u_lightbuffer;

  uniform float u_nearClip;
  uniform vec2 u_cluster_tile_size;
  uniform float u_cluster_depth_stride;
  uniform mat4 u_viewMatrix;

  // TODO: Read this buffer to determine the lights influencing a cluster
  uniform sampler2D u_clusterbuffer;

  varying vec3 v_position;
  varying vec3 v_normal;
  varying vec2 v_uv;


  //float getCulsterIndexK(float z_EyeSpace, float nearClip, float fovby2_radius, float ySlices) {
    //float c = log(10.0);
    //float tmp1 = log(-z_EyeSpace / nearClip) / c;
    //float tmp2 = log(1.0 + 2.0 * tan(fovby2_radius) / ySlices) / c;

    //return floor(0.12 * tmp1 / tmp2);
    //return 0.0;
  //}

  int getCulsterDepthIndex(float viewSpaceDepth, float nearClip) {
      //2.15 is calculated based on near and far clip
      //near Clip : 0.1
      //far  Clip : 1000.0
      return int(floor(2.15 * log(viewSpaceDepth - nearClip + 1.0)));
  }

  vec3 applyNormalMap(vec3 geomnor, vec3 normap) {
    normap = normap * 2.0 - 1.0;
    vec3 up = normalize(vec3(0.001, 1, 0.001));
    vec3 surftan = normalize(cross(geomnor, up));
    vec3 surfbinor = cross(geomnor, surftan);
    return normalize(normap.y * surftan + normap.x * surfbinor + normap.z * geomnor);
  }

  struct Light {
    vec3 position;
    float radius;
    vec3 color;
  };

  float ExtractFloat(sampler2D texture, int textureWidth, int textureHeight, int index, int component) {
    float u = float(index + 1) / float(textureWidth + 1);
    int pixel = component / 4;
    float v = float(pixel + 1) / float(textureHeight + 1);
    vec4 texel = texture2D(texture, vec2(u, v));
    int pixelComponent = component - pixel * 4;
    if (pixelComponent == 0) {
      return texel[0];
    } else if (pixelComponent == 1) {
      return texel[1];
    } else if (pixelComponent == 2) {
      return texel[2];
    } else if (pixelComponent == 3) {
      return texel[3];
    }
  }

  Light UnpackLight(int index) {
    Light light;
    float u = float(index + 1) / float(${params.numLights + 1});
    vec4 v1 = texture2D(u_lightbuffer, vec2(u, 0.3));
    vec4 v2 = texture2D(u_lightbuffer, vec2(u, 0.6));
    light.position = v1.xyz;

    // LOOK: This extracts the 4th float (radius) of the (index)th light in the buffer
    // Note that this is just an example implementation to extract one float.
    // There are more efficient ways if you need adjacent values
    light.radius = ExtractFloat(u_lightbuffer, ${params.numLights}, 2, index, 3);

    light.color = v2.rgb;
    return light;
  }

  // Cubic approximation of gaussian curve so we falloff to exactly 0 at the light radius
  float cubicGaussian(float h) {
    if (h < 1.0) {
      return 0.25 * pow(2.0 - h, 3.0) - pow(1.0 - h, 3.0);
    } else if (h < 2.0) {
      return 0.25 * pow(2.0 - h, 3.0);
    } else {
      return 0.0;
    }
  }

  void main() {
    vec3 albedo = texture2D(u_colmap, v_uv).rgb;
    vec3 normap = texture2D(u_normap, v_uv).xyz;
    vec3 normal = applyNormalMap(v_normal, normap);

    vec3 fragColor = vec3(0.0);

    vec3 pos_viewSpace = vec3(u_viewMatrix * vec4(v_position, 1.0));

    // determine which cluster this fragment is in
    int cluster_Idx_x = int(gl_FragCoord.x / u_cluster_tile_size.x);
    int cluster_Idx_y = int(gl_FragCoord.y / u_cluster_tile_size.y);
    //int cluster_Idx_z = int(getCulsterIndexK(v_eyeSpaceDepth, u_nearClip, u_fovby2_radius, u_ySlices));
    //int cluster_Idx_z = int((-pos_viewSpace.z - u_nearClip) / u_cluster_depth_stride);
    int cluster_Idx_z = getCulsterDepthIndex(-pos_viewSpace.z, u_nearClip);


    // clusterTexture Size
    const int clusterTexutreWidth  = int(${params.numXSlices}) * int(${params.numYSlices}) * int(${params.numZSlices});
    const int clusterTextureHeight = int(ceil((float(${params.maxLightsPerCluster}) + 1.0) / 4.0));

    // extract lights influencing this cluster from u_clusterbuffer
    int clusterIdx = cluster_Idx_x + cluster_Idx_y * int(${params.numXSlices}) + cluster_Idx_z * int(${params.numXSlices}) * int(${params.numYSlices});

    float cluster_u = float(clusterIdx + 1) / float(clusterTexutreWidth + 1);

    float cluster_v = 0.0; // because the texture space origin is at lower left, not upper left!

    float cluster_v_step = 1.0 / float(clusterTextureHeight + 1);

    cluster_v += cluster_v_step;

    vec4 cluster_texel = texture2D(u_clusterbuffer, vec2(cluster_u, cluster_v));

    int lightCountInCluster = int(cluster_texel[0]);

    int cluster_texel_fetch_Idx = 1;

    const int maxNumLights = int(min(float(${params.maxLightsPerCluster}),float(${params.numLights})));

    // Shade lights store in the cluster instead of all
    for (int i = 0; i < maxNumLights; ++i) {
      if(i == lightCountInCluster) {break;}

      // Fetch light index
      int lightIdx;
      if(cluster_texel_fetch_Idx == 0){
        lightIdx = int(cluster_texel[0]);
      }
      else if(cluster_texel_fetch_Idx == 1){
        lightIdx = int(cluster_texel[1]);
      }
      else if(cluster_texel_fetch_Idx == 2){
        lightIdx = int(cluster_texel[2]);
      }
      else if(cluster_texel_fetch_Idx == 3){
        lightIdx = int(cluster_texel[3]);
      }

      cluster_texel_fetch_Idx++;

      Light light = UnpackLight(lightIdx);
      float lightDistance = distance(light.position, v_position);
      vec3 L = (light.position - v_position) / lightDistance;

      float lightIntensity = cubicGaussian(2.0 * lightDistance / light.radius);
      //float lambertTerm = max(dot(L, normal), 0.0);

      float lambertTerm;

      if(${params.isToonShading}){
        // ramp shading
        float rampUnitLength =  0.25;
        float rampUnitValue = 0.33;
        // float rampCoord = dot(L, normal) * 0.5 + 0.5; // map from -1 -> 1 to 0 -> 1
        float rampCoord = max(dot(L, normal), 0.0);
        int rampLevel = int(rampCoord / rampUnitLength);
        lambertTerm = float(rampLevel) * rampUnitValue;
      }
      else{
        lambertTerm = max(dot(L, normal), 0.0);
      }

      fragColor += albedo * lambertTerm * light.color * vec3(lightIntensity);

      if(cluster_texel_fetch_Idx == 4){
        cluster_texel_fetch_Idx = 0;
        cluster_v += cluster_v_step;
        cluster_texel = texture2D(u_clusterbuffer, vec2(cluster_u, cluster_v));
      }

    }

    const vec3 ambientLight = vec3(0.025);
    fragColor += albedo * ambientLight;

    gl_FragData[0] = vec4(fragColor, 1.0);
  }
  `;
}

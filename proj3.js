import {Shader} from "../modules/class_shader.mjs"
import {Material, __js_materials} from "../modules/class_material.mjs"
import * as mat4 from "../lib/gl-matrix/mat4.js"
import {Light} from "../modules/class_light.mjs"
import {toRadian} from "../lib/gl-matrix/common.js"
import * as vec4 from "../lib/gl-matrix/vec4.js"
import {Axes} from "../modules/class_axes.mjs"
import * as THREE from "https://threejs.org/build/three.module.js"
import {OBJLoader} from "https://threejs.org/examples/jsm/loaders/OBJLoader.js"
import {Mesh} from "../modules/class_mesh.mjs"
import {shaders} from "../modules/shaders.mjs"

"use strict";

// 전역 변수
const tex_unit = 3;
// 헬기 정보 저장
let heliInfo = {
  x : 0.0,
  y : 0.3,
  z : 0.0,
  radius : 0.02,
  angle : 0
};
// 카메라 정보 저장
let cameraInfo = {
  fov : 50,
  x : 1.0,
  y : 1.0,
  z : 1.0,
  radius : Math.sqrt(3),
  rotateAngle : 45,
  tiltAngle : 45
};
// 라이트와 관련된 변수들
let numLights = 1;
let bulletPos = [];
// 유니폼 위치
const loc_aPosition = 0;
const loc_aNormal = 1;
const loc_aTex = 2;

function main() {
  // terrain의 vs
  const src_vert =
  `#version 300 es
  layout(location=${loc_aTex}) in vec4 aTex;
  uniform mat4 MVP;
  uniform mat4 MV;
  uniform sampler2D uSampler;
  out vec3 vNormal;
  out vec4 vPosEye;
  void main() {
    float scale = 0.25;
    vec4 position = vec4(aTex);
    position.x = position.x * 2.0 - 1.0;
    position.y = position.y * 2.0 - 1.0;
    position.z = scale * texture(uSampler, aTex.st).r;

    float sf = 0.005;
    vec3 s = vec3(2.0, 0.0, 0.0);
    vec3 t = vec3(0.0, 2.0, 0.0);
    s.z = (texture(uSampler, vec2(aTex.s+sf, aTex.t)).r - texture(uSampler, vec2(aTex.s-sf, aTex.t)).r) / (2.0*sf);
    t.z = (texture(uSampler, vec2(aTex.s, aTex.t+sf)).r - texture(uSampler, vec2(aTex.s, aTex.t-sf)).r) / (2.0*sf);
    vNormal = cross(s,t);
    vPosEye = MV*position;
    gl_Position =  MVP * position;
  }`;
  // terrain의 fs
  function src_frag({numLights}){
    return `#version 300 es
    precision mediump float;
    in vec4	vPosEye;
    in vec3	vNormal;
    out vec4 fColor;
    struct TMaterial
    {
      vec3	ambient;
      vec3	diffuse;
      vec3	specular;
      vec3	emission;
      float	shininess;
    };
    struct TLight
    {
      vec4	position;
      vec3	ambient;
      vec3	diffuse;
      vec3	specular;
      bool	enabled;
    };
    uniform TMaterial	material;
    uniform TLight		light[${numLights}];
    void main()
    {
      vec3	n = normalize(vNormal);
      vec3	l;
      vec3	v = normalize(-vPosEye.xyz);
      fColor = vec4(0.0);
      for(int i=0 ; i<${numLights} ; i++)
      {
        if(light[i].enabled)
        {
          if(light[i].position.w == 1.0)
            l = normalize((light[i].position - vPosEye).xyz);		// positional light
          else
            l = normalize((light[i].position).xyz);	// directional light
          float	l_dot_n = max(dot(l, n), 0.0);
          vec3	ambient = light[i].ambient * material.ambient;
          vec3	diffuse = light[i].diffuse * material.diffuse * l_dot_n;
          vec3	specular = vec3(0.0);
          if(l_dot_n > 0.0)
          {
            vec3	h = normalize(l + v);
            specular = light[i].specular * material.specular * pow(max(dot(h, n), 0.0), material.shininess);
          }
          fColor += vec4(ambient + diffuse + specular, 1);
        }
      }
      fColor.w = 1.0;
    }`;
  }
  // 초기화 코드
  const canvas = document.getElementById('webgl');
  const gl = canvas.getContext('webgl2');

  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0.7, 0.7, 0.7, 1.0);

  // terrain vao 생성
  const terrain = initTerrain({gl, loc_aTex});
  
  // V, P 생성
  const V = mat4.create();
  mat4.lookAt(V, [1.0, 1.0, 1.0], [0, 0, 0], [0, 1, 0]);
  
  const P = mat4.create();
  mat4.perspective(P, toRadian(cameraInfo.fov), 1, 1, 100);
  
  // 기본 라이트 한개 생성
  let basic_light = new Light
    (
        gl,
        [0.0, 0.08, 0.0, 1.0],
        [0.1, 0.1, 0.1, 1.0],
        [1.0, 1.0, 1.0, 1.0],
        [1.0, 1.0, 1.0, 1.0],
        false
    );
    
  // 축 생성
  const axes = new Axes(gl);

  // 텍스쳐 불러오기
  let textureInfo = initTextures(gl);
  let texture = textureInfo[0];
  let image = textureInfo[1];
  

  // 헬리콥터 몸체와 프로펠러 로딩 (obj 파일)
  let heli = new Mesh({gl, loc_aPosition});
  let propeller = new Mesh({gl, loc_aPosition});

	let manager = new THREE.LoadingManager();
	manager.onProgress = function ( item, loaded, total ) {
		console.log( item, loaded, total );
  };
  
  let heliUrl = '/resources/heli.obj'
  let propellerUrl = '/resources/propeller.obj'

  let loader = new OBJLoader( manager );

  loader.load(heliUrl,
    function(object){
      for(let obj of object.children){
        if(obj.type =="Mesh"){
          heli.init_from_THREE_geometry(gl, obj.geometry);
        }
      }
    }
  );

  loader.load(propellerUrl, function(object){
      for(let obj of object.children){
        if(obj.type =="Mesh"){
          propeller.init_from_THREE_geometry(gl, obj.geometry);
        }
      }
  });

  // 애니메이션 관련 변수들
  let t_last = Date.now();
  let propellerRotateM = mat4.create();
  const ANGLE_STEP = 100.0;

  // 렌더링 루프
  let tick = function(){
    let list_lights = [basic_light];

    // 시간 계산
    let now = Date.now();
    let elapsed = now - t_last;
    t_last = now;

    // 총알 위치 변경, 땅에 닿으면 삭제
    let i = bulletPos.length;
    while(i--){
      if(!("time" in bulletPos[i])){
        bulletPos[i].time = now;
      }
      bulletPos[i].x += bulletPos[i].dx;
      bulletPos[i].y += bulletPos[i].g*((now - bulletPos[i].time) / 1000.0);
      bulletPos[i].z += bulletPos[i].dz;

      if(bulletPos[i].y < 0){
        bulletPos.splice(i,1);
        numLights -= 1;
      }
      else{
        let bullet = new Light(
          gl,
          [bulletPos[i].x, bulletPos[i].y, bulletPos[i].z, 1.0],
          [0.1, 0.1, 0.1, 1.0],
          [1.0, 1.0, 1.0, 1.0],
          [1.0, 1.0, 1.0, 1.0],
          false
        );
        list_lights.push(bullet);
      }
    }

    // 프로펠러 애니메이션을 위한 매트릭스
    mat4.rotate(propellerRotateM,propellerRotateM, toRadian(((ANGLE_STEP*elapsed) / 1000.0) % 360.0), [0,1,0]);
    
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // 키 입력 시 카메라 세팅 변경
    mat4.lookAt(V, [cameraInfo.x, cameraInfo.y, cameraInfo.z], [0,0,0], [0,1,0]);
    mat4.perspective(P, toRadian(cameraInfo.fov), 1, 1, 100);

    // 축 렌더링
    axes.render(gl, V, P);

    // 라이트 렌더링
    // 기본 라이트는 디렉셔널 라이트
    list_lights[0].turn_on(true);
    list_lights[0].set_type(false);
    list_lights[0].render(gl, V, P);
    // 총알은 포지셔널 라이트
    for(i = 1; i < list_lights.length; ++i){
      list_lights[i].turn_on(true);
      list_lights[i].set_type(true);
      list_lights[i].render(gl, V, P);
    }
    // 헬리콥터와 지형 렌더링
    renderHeli(gl, heli, propeller, list_lights, heliInfo, V, P, propellerRotateM);
    renderTerrain(gl, src_vert, src_frag({numLights}), terrain, texture, image, V, P, list_lights);
    
    requestAnimationFrame(tick,canvas);
  }
  tick();
}

// 헬리콥터 렌더링
function renderHeli(gl, heli, propeller, list_lights, heliInfo, V, P, propellerRotateM){
  let heliShader = new Shader(gl,
    shaders.src_vert_Blinn_Phong({loc_aPosition, loc_aNormal}),
    shaders.src_frag_Blinn_Phong({numLights}));

  gl.useProgram(heliShader.h_prog);
  
  // let M = heliM;
  const M = mat4.create();
  mat4.translate(M, M, [heliInfo.x, heliInfo.y, heliInfo.z]);  
  mat4.rotate(M, M, toRadian(heliInfo.angle), [0,1,0]);

  mat4.copy(heli.M, M);

  mat4.multiply(M,M,propellerRotateM);
  mat4.copy(propeller.M, M);

  heli.render(gl, heliShader, list_lights, __js_materials["chrome"], V,P);
  propeller.render(gl, heliShader, list_lights, __js_materials["gold"], V, P);
  
  gl.useProgram(null);
}

// view_transform.js 참고
function initArrayBuffer(gl, data, num, type, loc_attribute) {
  const buffer = gl.createBuffer();   // Create a buffer object
  if (!buffer) {
    console.log('Failed to create the buffer object');
    return false;
  }
  // Write date into the buffer object
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  // Assign the buffer object to the attribute variable
  gl.vertexAttribPointer(loc_attribute, num, type, false, 0, 0);
  // Enable the assignment of the buffer object to the attribute variable
  gl.enableVertexAttribArray(loc_attribute);
  
  return true;
}

// 지형 초기화
function initTerrain({gl, loc_aTex}){
  let textureCoord = [];
  let i, j;
  let n = 300;
  for(i = 0; i < n; ++i){
    for(j = 0; j< n; ++j){
      let fn = parseFloat(n);
      textureCoord.push(j/fn, i/fn);
      textureCoord.push((j+1)/fn, i/fn);
      textureCoord.push((j+1)/fn, (i+1)/fn);
      textureCoord.push(j/fn, (i+1)/fn);
    }
  }

  let indiceArr = [];
  let num = 0;
  for(i = 0; i<n*n; ++i){
    indiceArr.push(num,num+1,num+2,num,num+2,num+3);
    num+=4;
  }
  const indices = new Uint32Array(indiceArr)

  let vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  // Create a buffer object
  const indexBuffer = gl.createBuffer();
  if (!indexBuffer) 
    return -1;
  
  // Write the vertex coordinates and color to the buffer object
  if (!initArrayBuffer(gl, new Float32Array(textureCoord), 2, gl.FLOAT, loc_aTex))
    return -1;
  
  // Write the indices to the buffer object
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  
  gl.bindVertexArray(null);
  
  return {vao, n:indices.length};
}

// 지형 렌더링
function renderTerrain(gl, src_vert, src_frag, terrain, texture, image, V, P, list_lights){
  const prog = new Shader(gl, src_vert, src_frag);

  gl.useProgram(prog.h_prog);
  gl.bindVertexArray(terrain.vao);
  const loc_uSampler = gl.getUniformLocation(prog.h_prog, "uSampler");

  const M = mat4.create();
  mat4.translate(M, M, [0, -0.2, 0]); // 살짝 아래로 설정
  mat4.rotate(M, M, toRadian(-90), [1, 0, 0]); // 앞을 보고 있어서 위를 보도록 방향을 돌려준다.

  const MV = mat4.create();
  mat4.copy(MV, V);
  mat4.multiply(MV, MV, M);
  gl.uniformMatrix4fv(prog.loc_uniforms["MV"], false, MV);

  const MVP = mat4.create();
  mat4.copy(MVP, P);
  mat4.multiply(MVP, MVP, MV);
  gl.uniformMatrix4fv(prog.loc_uniforms["MVP"], false, MVP);

  // class_mesh.mjs에서 가져옴
  function set_uniform_lights(gl, shader, lights, V)
  {
    let i = 0;
    let v = vec4.create();
    for(let name in lights)
    {
      let light = lights[name];
      mat4.copy(MV, V);
      mat4.multiply(MV, MV, light.M);
      vec4.transformMat4(v, light.position, MV);
      gl.uniform4fv(shader.loc_uniforms[`light[${i}].position`], v);
      gl.uniform3fv(shader.loc_uniforms[`light[${i}].ambient`], light.ambient);
      gl.uniform3fv(shader.loc_uniforms[`light[${i}].diffuse`], light.diffusive);
      gl.uniform3fv(shader.loc_uniforms[`light[${i}].specular`], light.specular);
      gl.uniform1i(shader.loc_uniforms[`light[${i}].enabled`], light.enabled);
      vec4.transformMat4(v, light.direction, MV);
      gl.uniform4fv(shader.loc_uniforms[`light[${i}].direction`], v);
      gl.uniform1f(shader.loc_uniforms[`light[${i}].cutoff_angle`], Math.cos(light.cutoff_angle*Math.PI/180.0));
      
      i++;
    }
  }
  
  set_uniform_lights(gl, prog, list_lights, V);
  
  let material = __js_materials["copper"];

  // class_mesh.mjs에서 가져옴
  function set_uniform_material(gl, shader, mat)
  {
      gl.uniform3fv(shader.loc_uniforms["material.ambient"], mat.ambient);
      gl.uniform3fv(shader.loc_uniforms["material.diffuse"], mat.diffusive);
      gl.uniform3fv(shader.loc_uniforms["material.specular"], mat.specular);
      gl.uniform1f( shader.loc_uniforms["material.shininess"], mat.shininess*128.0);
  }

  set_uniform_material(gl, prog, material);

  // tex-sampler.js 참고
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1); // Flip the image's y axis

  gl.activeTexture(gl.TEXTURE0+ tex_unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);

  let sampler = gl.createSampler();

  gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.bindSampler(tex_unit, sampler);
  gl.uniform1i(loc_uSampler, tex_unit);

  gl.drawElements(gl.TRIANGLES, terrain.n, gl.UNSIGNED_INT, 0);

  gl.bindVertexArray(null);
  gl.useProgram(null);

}

// tex-sampler.js 참고
function initTextures(gl) {
  let texture = gl.createTexture();   // Create a texture object
  if (!texture) {
    console.log('Failed to create the texture object');
    return false;
  }
  
  let image = new Image();  // Create the image object
  if (!image) {
    console.log('Failed to create the image object');
    return false;
  }
  
  // Tell the browser to load an image
  image.src = '/resources/043-ue4-heightmap-guide-02.jpg';
  
  return [texture, image];
}

// 키 이벤트 처리
// 키가 동시에 여러개 눌리는 것을 감지하기 위한 변수
let keysPressed = {};
window.addEventListener("keydown", (e) => {
  keysPressed[e.key] = true;
  document.getElementById("key_output").innerHTML = e.key;
  // 수직 방향 이동
  if(e.key == 'a' || e.key == 'A'){
    heliInfo.y += 0.02;
  }
  else if(e.key == 'z' || e.key == 'Z'){
    heliInfo.y -= 0.02;
  }
  // 카메라 회전
  else if(keysPressed['Shift'] && keysPressed['ArrowLeft']){
    document.getElementById("key_output").innerHTML = "Shift + ArrowLeft";
    const xzRad = Math.sqrt(Math.pow(cameraInfo.x,2)+Math.pow(cameraInfo.z,2));
    cameraInfo.rotateAngle += 10;
    cameraInfo.x = xzRad * Math.cos(toRadian(cameraInfo.rotateAngle));
    cameraInfo.z = xzRad * Math.sin(toRadian(cameraInfo.rotateAngle));
  }
  else if(keysPressed['Shift'] && keysPressed['ArrowRight']){
    document.getElementById("key_output").innerHTML = "Shift + ArrowRight";
    const xzRad = Math.sqrt(Math.pow(cameraInfo.x,2)+Math.pow(cameraInfo.z,2));
    cameraInfo.rotateAngle -= 10;
    cameraInfo.x = xzRad * Math.cos(toRadian(cameraInfo.rotateAngle));
    cameraInfo.z = xzRad * Math.sin(toRadian(cameraInfo.rotateAngle));  
  }
  // 카메라 틸트
  else if(keysPressed['Shift'] && keysPressed['ArrowUp']){
    document.getElementById("key_output").innerHTML = "Shift + ArrowUp";
    cameraInfo.tiltAngle += 5;
    cameraInfo.y = cameraInfo.radius * Math.sin(toRadian(cameraInfo.tiltAngle));
    const xzRad = cameraInfo.radius * Math.cos(toRadian(cameraInfo.tiltAngle));
    cameraInfo.x = xzRad * Math.cos(toRadian(cameraInfo.rotateAngle));
    cameraInfo.z = xzRad * Math.sin(toRadian(cameraInfo.rotateAngle));
  }
  else if(keysPressed['Shift'] && keysPressed['ArrowDown']){
    document.getElementById("key_output").innerHTML = "Shift + ArrowDown";
    cameraInfo.tiltAngle -= 5;
    cameraInfo.y = cameraInfo.radius * Math.sin(toRadian(cameraInfo.tiltAngle));
    const xzRad = cameraInfo.radius * Math.cos(toRadian(cameraInfo.tiltAngle));
    cameraInfo.x = xzRad * Math.cos(toRadian(cameraInfo.rotateAngle));
    cameraInfo.z = xzRad * Math.sin(toRadian(cameraInfo.rotateAngle));
  }

  // 헬기 앞으로 이동
  else if(e.key == 'ArrowUp'){
    heliInfo.x += heliInfo.radius * Math.cos(toRadian(heliInfo.angle));
    heliInfo.z -= heliInfo.radius * Math.sin(toRadian(heliInfo.angle));
  }
  else if(e.key == 'ArrowDown'){
    heliInfo.x -= heliInfo.radius * Math.cos(toRadian(heliInfo.angle));
    heliInfo.z += heliInfo.radius * Math.sin(toRadian(heliInfo.angle));
  }
  // 헬기 회전
  else if(e.key == 'ArrowRight'){
    heliInfo.angle -= 10;
  }
  else if(e.key == 'ArrowLeft'){
    heliInfo.angle += 10;
  }
  // 줌 인
  else if(e.key == '=' || e.key == '+'){
    cameraInfo.fov -= 5;
  }
  // 줌 아웃
  else if(e.key == '-' || e.key == '_'){
    cameraInfo.fov += 5;
  }
  // 총알 생성
  else if(e.key == ' '){
    document.getElementById("key_output").innerHTML = "SpaceBar";
    if(numLights < 11){
      numLights += 1
      bulletPos.push({
        x : heliInfo.x,
        y : heliInfo.y + 0.05, // 중앙에서 나오도록
        z : heliInfo.z,
        dx : heliInfo.radius * Math.cos(toRadian(heliInfo.angle)) / 10.0,
        dz : -heliInfo.radius * Math.sin(toRadian(heliInfo.angle)) / 10.0,
        g : -0.0007,
      })
    }
  }
});
// 눌려있던 키 떨어질 때 눌려있는 키에서 삭제
window.addEventListener('keyup', (e)=>{
  delete keysPressed[e.key];
});

main();

const shp = require('shapefile');
const THREE = require('three');
const three2stl = require('three2stl-stream');
const proj4 = require('proj4');
const polylabel = require('polylabel');
const fs = require('fs');
const csv = require('fast-csv');

const nad83 = 'GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]]';
const google = 'EPSG:3857';

let stlStream = null;

const fipsLookup = {};

processElectionResults();

function processElectionResults() {
	var stream = fs.createReadStream("source_data/pres16results.csv");
 
	var csvStream = csv({headers:true, object:true})
	    .on("data", function(data){
	         data.votes = parseInt(data.votes);
	         data.total_votes = parseInt(data.total_votes);
	         data.pct = parseFloat(data.pct);

	         if(data.fips != "NA" && data.county != "NA" && data.cand != "NA") {

	         	if(fipsLookup[data.fips] == null)
	         		fipsLookup[data.fips] = {'fips': data.fips, total_votes: data.total_votes};

	         	const candInitials = data.cand.toLowerCase().split(" ").reduce((result, part) => result + part.slice(0,1), '');
	         	fipsLookup[data.fips][candInitials + '_votes'] = data.votes;
	         	fipsLookup[data.fips][candInitials + '_pct'] = data.pct;
	         }
	    })
	    .on("end", function(){

	    	const voteCounts = {
	    		dt: 0,
	    		hc: 0
	    	};

	    	let fipsArray = [];

	    	for(fips in fipsLookup) {
	    		const county = fipsLookup[fips];
	    		county.max_pct = Math.max(county.hc_pct, county.dt_pct);

	    		fipsArray.push(county);
	    	}

	    	
	    	let trumpLayerCount = 0;
	    	let clintonLayerCount = 0;

	    	let leftVoteCount = 0;
	    	let rightVoteCount = 0;

	    	fipsArray.sort((a,b) =>  a.max_pct < b.max_pct ? 1 : (a.max_pct > b.max_pct ? -1 : 0));
			
			
			//fipsArray.sort((a,b) =>  a.hc_pct < b.hc_pct ? 1 : (a.hc_pct > b.hc_pct ? -1 : 0));
			//fipsArray.sort((a,b) =>  a.dt_pct < b.dt_pct ? 1 : (a.dt_pct > b.dt_pct ? -1 : 0));
			
			//fipsArray = fipsArray.filter((f) => f.max_pct >= .5 );
			
			/*
			fipsArray.sort((a,b) =>  {
				const aval = Math.abs(a.hc_pct - .5);
				const bval = Math.abs(b.hc_pct - .5);

				return aval < bval ? 1 : (aval > bval ? -1 : 0)
			});
			*/
			

	    	fipsArray.forEach((f) => {
	    		
	    		const model = {
	    			x_pct: (f.max_pct - .5) * (f.hc_pct > f.dt_pct ? 1 : -1)
	    		};

	    		if(f.max_pct < .5) {
					model.start = leftVoteCount;
	    			leftVoteCount += f.total_votes;
	    			model.end = leftVoteCount;
	    			
	    			model.offsetY = 0;//200000;
					model.x_pct = 0;
	    		}
	    		else if(f.hc_pct < f.dt_pct) {
	    			model.start = rightVoteCount;
	    			rightVoteCount += f.total_votes;
	    			model.end = rightVoteCount;
	    			
	    			model.offsetY = 0;//200000;
					//model.x_pct = -.7;

	    			trumpLayerCount++;
	    		}
	    		else {
	    			model.start = leftVoteCount;
	    			leftVoteCount += f.total_votes;
	    			model.end = leftVoteCount;
	    			
	    			model.offsetY = 0;//-200000;
					//model.x_pct = .7;
	    			
	    			clintonLayerCount++;
	    		}

	    		fipsLookup[f.fips].model = model;
	    	});

	    	processCounties('bridge.stl');
	    });
	 
	stream.pipe(csvStream);
}

function processCounties(filename, callback) {
	stlStream = new three2stl();

	shp.open("source_data/cb_2015_us_county_20m/cb_2015_us_county_20m.shp")
	  .then(source => source.read()
	    .then(function processShpResult(result) {
	      if (result.done) {
	      	stlStream.finish(filename);
	      	if(callback !== null)
	      		callback();
	      }
	      else {
	      	processCountyShape(result.value);
	      	source.read().then(processShpResult);
	      }
	    }))
	  .catch(error => console.error(error.stack));
}


function processCountyShape(geojson) {
	const fips = parseInt(geojson.properties.GEOID).toString();
	
	if(fipsLookup[fips] === undefined || fipsLookup[fips].model == null)
		return;

	const start = fipsLookup[fips].model.start/30;
	const end = fipsLookup[fips].model.end/30;
	const offsetX = fipsLookup[fips].model.x_pct * 2000000;

	const geom = geojson.geometry;
	
	const polys = geom.type == "MultiPolygon" ? geom.coordinates : [geom.coordinates];
	polys.forEach((poly) => {
		processPolygon(poly, start, end, offsetX, fipsLookup[fips].model.offsetY);
	});
}

function processPolygon(poly, startZ, endZ, centerOffsetX, centerOffsetY) {
	let pole = polylabel(poly);

	pole = project(pole);

	const offsetX = pole[0] * -1 + centerOffsetX;
	const offsetY = pole[1] * -1 + centerOffsetY;
	
	const shapes = poly.map( coords2three );
	
	const outerShape = shapes.shift();
	outerShape.holes = shapes;

	var geometry = new THREE.ExtrudeGeometry( outerShape, {amount:endZ-startZ, bevelEnabled: false} );

	geometry.applyMatrix( new THREE.Matrix4().makeTranslation( offsetX, offsetY, startZ ) );

	stlStream.write(geometry);

	return geometry;
}

function project(coord) {
	return proj4(nad83, google, coord);
}

function coords2three(coords) {
	coords = coords.map( (coord) => project(coord) );

	return new THREE.Shape(
		coords.map( 
			(coord) => new THREE.Vector2(coord[0], coord[1]) 
		)
	);
}

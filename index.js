var request = require('request');
var fs = require('fs');
var events = require('events');
var util = require('util');

function orgchart() {
	this.sessionId = "";
	this.imageWidth = "256";
	this.imageHeight = "256";
	this.loaded = false;
	this.zoomLevel = 8; //256x256 tiles = can hold up to ~65,500 employees!
	this.lastLoadedDate = "";
	this.soql; //this is the SOQL to get all employees.
	this.employees = [];
	this.orgSize;
	this.instanceUrl;

	events.EventEmitter.call(this);
}

util.inherits(orgchart, events.EventEmitter);


orgchart.prototype.load = function() {
	var self = this;

	request({
		url: this.soql,
		headers: {
			"Authorization": "OAuth " + this.sessionId
		}
	}, function(error, response, body) {
		if (!error && response.statusCode == 200) {
			var body = JSON.parse(body);
			if (!self.orgSize) {
				self.orgSize = body.totalSize;
			}
			self.employees = self.employees.concat(body.records);

			self.emit('soql-done', self.employees);

			//if there are more employees.. recurse
			if (body.nextRecordsUrl) {
				self.soql = self.instanceUrl + body.nextRecordsUrl;
				self.load();
			} else {
				self.emit('done', self.employees);
				self.buildTreeFromUserRecords()
			}
		} else {
			console.error(response.body);
			self.emit('error', response.body);
		}
	});
};



//build tree
orgchart.prototype.buildTreeFromUserRecords = function() {
	var employees = this.employees;

	// flatten to object with string keys that can be easily referenced later
	var flat = {};
	var len = employees.length;
	for (var i = 0; i < len; i++) {
		var key = 'id' + employees[i].Id;
		flat[key] = employees[i];
	}

	// add child container array to each node
	for (var i in flat) {
		flat[i].children = []; // add children container
	}

	// populate the child container arrays
	for (var i in flat) {
		var parentkey = 'id' + flat[i].ManagerId;
		if (flat[parentkey]) {
			flat[parentkey].children.push(flat[i]);
		}
	}


	// find the root nodes (no parent found) and create the hierarchy tree from them
	var root = [];
	for (var i in flat) {
		var parentkey = 'id' + flat[i].ManagerId;
		if (!flat[parentkey]) {
			root.push(flat[i]);
		}
	}

	this.tree = root;
	this.emit('tree-done', this.tree);
	this.depthFirstSearch(root[0]);

	//create grid to associate items to map's xy.
	this.initItemsInGrid();

	//do BFS to add items to grid and also get other metrics.	
	this.breadthFirstSearch([root[0]], this.itemsInGrid);

	this.emit('loaded'); //fully loaded
}

orgchart.prototype.initItemsInGrid = function() {
	var maxZoom = this.zoomLevel;
	var numberOfTiles = Math.pow(2, maxZoom);
	var centerTileX = centerTileY = numberOfTiles / 2;

	var totalItems = this.employees.length;
	var totalItemsInXaxis = totalItemsInYaxis = Math.ceil(Math.sqrt(totalItems));
	var x = centerTileX - Math.ceil(totalItemsInXaxis / 2);
	var y = centerTileY - Math.ceil(totalItemsInYaxis / 2);

	//console.log(" x or centerTileX =" + x + " y =" + y + " totalItemsInXaxis =" + totalItemsInXaxis + " totalItems =" + totalItems);


	this.southWestCoords = {x: x * this.imageWidth, y: (x + totalItemsInXaxis) * this.imageWidth};
	this.northWestCoords = {x: (y + totalItemsInXaxis) * this.imageHeight,  y: y * this.imageHeight};


	this.itemsInGrid = new ItemsInGrid(x, y, totalItemsInXaxis, totalItemsInYaxis);
};

orgchart.prototype.getItemByXY = function(xSlashy) {
	return this.itemsInGrid.getItem(xSlashy);
};

orgchart.prototype.getXYByEmail = function(xSlashy) {
	return this.itemsInGrid.getXYByEmail(xSlashy);
};

orgchart.prototype.getOrtChartById = function(id) {
	return this.getOrgChart(id);
};

orgchart.prototype.getOrgChartByXY = function(xSlashy) {
	var item = this.itemsInGrid.getItem(xSlashy);
	if(!item || !item.Id) {
		return {};
	}
	return this.getOrgChart(item.Id);
};

orgchart.prototype.getOrgChart = function(employeeEmailOrId) {
	if (!employeeEmailOrId) {
		return {};
	}

	var emp = this.getEmployeeByEmailOrId(employeeEmailOrId);
	var empManager = this.getEmployeeByEmailOrId(emp.ManagerId);
	var empDR = this.geDirectReportsByManagerId(emp.Id);


	return {
		employee: emp || {},
		manager: empManager || {},
		directReports: empDR || {}
	};
};

orgchart.prototype.getEmployeeByEmailOrId = function(emailOrId) {
	if(!emailOrId || emailOrId == "") {
		return {};
	}
	var len = this.employees.length;
	emailOrId = emailOrId.toLowerCase();
	for (var i = 0; i < len; i++) {
		var emp = this.employees[i];
		if (emp.Email.toLowerCase() == emailOrId || emp.Id.toLowerCase() == emailOrId) {
			return this.serializeEmployee(emp);
		}
	}
};

orgchart.prototype.geDirectReportsByManagerId = function(managerId) {
	if(!managerId || managerId == "") {
		return {};
	}

	var found = false;
	var directReports = [];
	var self = this;

	function dfs(root) {
		if (found) {
			return;
		}
		if (root.Id == managerId) {
			if (root.children) {
				var children = root.children;
				var len = children.length;
				for (var i = 0; i < len; i++) {
					directReports.push(self.serializeEmployee(children[i]));
				}
			}
			found = true;
		}
		var children = root["children"];
		if (children.length > 0) {
			for (var i = 0; i < children.length; i++) {
				if (found) {
					break;
				}
				dfs(children[i]);
			}
		}
	}

	//call dfs..
	dfs(this.tree[0]);

	return directReports;
};

orgchart.prototype.serializeEmployee = function(user) {
	var newUser = {};
	var len = this.fields.length;
	for (var i = 0; i < len; i++) {
		newUser[this.fields[i]] = user[this.fields[i]];
	}
	return newUser;
};

function ItemsInGrid(startX, startY, totalXItems, totalYItems) {
	this.startX = startX;
	this.startY = startY;
	this.totalXItems = totalXItems;
	this.totalYItems = totalYItems;
	this.xCnt = 0;
	this.yCnt = -1;

	this._grid = {};

	this.addItem = function(item) {
		var x = this.xCnt % this.totalXItems;
		if (x == 0) { //increase Y when new row starts
			//console.log("mod x == 0; this.xCnt " + this.xCnt + " this.yCnt " + this.yCnt);
			this.yCnt++;
		}
		var gridX = this.startX + x;
		var gridY = this.startY + this.yCnt;

		if (this.yCnt == 0) {
			//console.log(gridX + "/" + gridY);
		}

		item.Email = item.Email.toLowerCase(); //store it in lowercase to improve get perf
		this._grid[gridX + "/" + gridY] = item;
		this.xCnt++;
	}

	this.printItems = function() {
		console.log(JSON.stringify(this._grid));
	}

	this.getItem = function(xSlashY) {
		return this._grid[xSlashY];
	}

	this.getXYByEmail = function(email) {
		for(var xSlashY in this._grid) {
			if(this._grid[xSlashY].Email == email.toLowerCase()) {
				return xSlashY;
			}
		}
		return;
	}
}


orgchart.prototype.breadthFirstSearch =
	function(nodesArray, itemsInGrid) {
		var bfsCnt = 0;
		var currentLevelTotal = 0;
		var currentLevel = 0;
		var employeesAtLevel = {};

		//do bfs..

		function bfs(nodes) {
			var nextChildren = [];
			++currentLevel;

			console.log("-----Current level = " + currentLevel + " ---");

			for (var i = 0; i < nodes.length; i++) {
				var currentNode = nodes[i];
				//console.log(currentNode.id);
				++bfsCnt;
				++currentLevelTotal;

				//if passed.. also add items to grid object
				if (itemsInGrid) {
					itemsInGrid.addItem(currentNode);
				}

				if (currentNode.children.length > 0) {
					nextChildren = nextChildren.concat(currentNode.children);
				}
			}
			console.log("currentLevelTotal = " + currentLevelTotal);
			//store it
			employeesAtLevel[currentLevel] = currentLevelTotal;
			if (nextChildren.length > 0) {
				currentLevelTotal = 0; //reset
				bfs(nextChildren);
			}
		}

		//call bfs
		bfs(nodesArray);

		this.employeesAtLevel = employeesAtLevel; //store it on orgchart obj
		console.log("total items in BFS " + bfsCnt);
		console.log(JSON.stringify(this.employeesAtLevel));
}

orgchart.prototype.depthFirstSearch = function(rootData) {
	var parentsCnt = 0;
	var leafsCnt = 0;
	var totalDepth = 0;
	var largestTeamSize = 0;
	var currentTeamSize = 0;
	var largestTeamManager = 0;
	var numberOfTeams = 0;

	function dfs(root) {
		root.currentParentDepth = root.currentParentDepth ? root.currentParentDepth : 1;
		if (totalDepth < root.currentParentDepth) {
			totalDepth = root.currentParentDepth;
		}
		var children = root["children"];
		if (children.length == 0) {
			++leafsCnt;
		} else {
			++parentsCnt;
			++numberOfTeams;
			currentTeamSize = children.length;
			if (largestTeamSize < currentTeamSize) {
				largestTeamSize = currentTeamSize;
				largestTeamManager = root;
			}
			//console.log(root.Id);
			for (var i = 0; i < children.length; i++) {
				children[i].currentParentDepth = root.currentParentDepth + 1;
				dfs(children[i]);
			}
		}
	}

	//call dfs..
	dfs(rootData);

	//store the result in the orgchart object
	this.parentsCnt = parentsCnt;
	this.leafsCnt = leafsCnt;
	this.totalDepth = totalDepth;
	this.largestTeamSize = largestTeamSize;
	this.numberOfTeams = numberOfTeams;
	this.largestTeamManager = largestTeamManager;

	console.log("parentsCnt = " + parentsCnt);
	console.log("leafsCnt = " + leafsCnt);
	console.log("parentsCnt + leafsCnt = " + (parentsCnt + leafsCnt));
	console.log("totalDepth = " + totalDepth);
	console.log("largestTeamSize = " + largestTeamSize);
	console.log("numberOfTeams = " + numberOfTeams);
	console.log(largestTeamManager.Id + " " + largestTeamManager.Name);
}


exports = module.exports = new orgchart();

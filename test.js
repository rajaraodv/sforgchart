var orgchart = require('./index.js');
orgchart.sessionId = "00D000000000062!AQsAQM1YorrursF_7rBxyJz7.uyIHWBmhJI0LdTJCHDzXN9Ban334.aMtEubV6MduShRZ7mt78sER250p94zJrxFwG.P4csb";

orgchart.zoomLevel = 8; //256x256 tiles = can hold up to ~65,500 employees!

orgchart.instanceUrl = 'https://org62.my.salesforce.com';
orgchart.fields = ['Name', 'SmallPhotoUrl', 'Title', 'ManagerId', 'Email', 'Phone', 'Id'];
orgchart.soql = 'https://org62.my.salesforce.com/services/data/v27.0/query?q=SELECT Name,SmallPhotoUrl,Title,ManagerId,Email,Phone,Id from User WHERE email LIKE \'%25@salesforce.com\' And UserType=\'Standard\' And IsActive=TRUE And (ManagerId !=null OR Email = \'ceo@salesforce.com\')';
orgchart.on('done', function(users){
	console.log('in done');
	console.log(users.length);
});

orgchart.on('loaded', function() {
	console.log('in loaded')
	console.log(JSON.stringify(orgchart.getOrgChart('00530000000bqogAAA')));
})

orgchart.load();

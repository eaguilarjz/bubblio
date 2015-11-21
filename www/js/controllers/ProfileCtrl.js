//ProfileController
angular.module('starter.controllers')

.controller('ProfileCtrl', function($scope, $state, $stateParams, CurrentUser) {
    $scope.data = {};
	
	$scope.data.firstname = CurrentUser.getCurrentFirstName();
	$scope.data.lastname = CurrentUser.getCurrentLastName();
	console.log($scope.data.firstname);

    $scope.saveInfo = function() {
    	var currentUser = Parse.User.current();
        currentUser.set("firstname", $scope.data.firstname);
        currentUser.set("lastname", $scope.data.lastname);
        currentUser.save();
        alert("Profile saved.");
    }
	
});
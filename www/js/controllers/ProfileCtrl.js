//ProfileController
angular.module('starter.controllers')

.controller('ProfileCtrl', function($scope, $state, $rootScope, $stateParams, CurrentUser) {
    $scope.data = {};
	
	$scope.data.firstname = CurrentUser.getCurrentFirstName();
	$scope.data.lastname = CurrentUser.getCurrentLastName();


    $scope.saveInfo = function() {
    	var currentUser = Parse.User.current();
        currentUser.set("firstname", $scope.data.firstname);
        currentUser.set("lastname", $scope.data.lastname);
        currentUser.save();
        alert("Profile saved.");
    }
	
});
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract HealthVault {

    mapping(address => string) private records;
    mapping(address => mapping(address => bool)) private accessList;

    event RecordUploaded(address patient, string ipfsHash);
    event AccessGranted(address patient, address doctor);
    event AccessRevoked(address patient, address doctor);

    // Patient uploads their own record
    function uploadRecord(string memory ipfsHash) public {
        records[msg.sender] = ipfsHash;
        emit RecordUploaded(msg.sender, ipfsHash);
    }

    // Doctor uploads record for patient (requires access)
    function uploadRecordFor(address patient, string memory ipfsHash) public {
        require(
            patient == msg.sender || accessList[patient][msg.sender],
            "Access denied"
        );
        records[patient] = ipfsHash;
        emit RecordUploaded(patient, ipfsHash);
    }

    // Grant access to a doctor
    function grantAccess(address doctor) public {
        accessList[msg.sender][doctor] = true;
        emit AccessGranted(msg.sender, doctor);
    }

    // Revoke access from a doctor
    function revokeAccess(address doctor) public {
        accessList[msg.sender][doctor] = false;
        emit AccessRevoked(msg.sender, doctor);
    }

    // Doctor reads patient record (requires access)
    function getRecord(address patient) public view returns (string memory) {
        require(accessList[patient][msg.sender], "Access denied");
        return records[patient];
    }

    // Patient reads their OWN record — no access check needed
    function getMyRecord() public view returns (string memory) {
        return records[msg.sender];
    }

    // Check if doctor has access
    function hasAccess(address patient, address doctor) public view returns (bool) {
        return accessList[patient][doctor];
    }
}

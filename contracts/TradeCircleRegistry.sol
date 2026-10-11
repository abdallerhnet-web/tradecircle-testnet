// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// TradeCircle registry. Holds NO funds and executes NO trades.
/// It records rooms, membership, proposals (as hash + data in an event) and one vote per wallet.
/// A vote here is a signal only. It never authorizes a trade.
contract TradeCircleRegistry {
    struct Room { address creator; uint64 createdAt; }
    struct Proposal { uint256 roomId; address author; bool closed; bool outcomeRecorded; }

    uint256 public roomCount;
    uint256 public proposalCount;
    mapping(uint256 => Room) public rooms;
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public isMember;
    mapping(uint256 => mapping(address => uint8)) public voteOf; // 0 none, 1 for, 2 against, 3 abstain

    event RoomCreated(uint256 indexed roomId, address indexed creator, string name);
    event Joined(uint256 indexed roomId, address indexed member);
    event ProposalSubmitted(uint256 indexed proposalId, uint256 indexed roomId, address indexed author, bytes32 thesisHash, string data);
    event Voted(uint256 indexed proposalId, address indexed voter, uint8 choice);
    event ProposalClosed(uint256 indexed proposalId, address indexed by);
    event OutcomeRecorded(uint256 indexed proposalId, address indexed author, string data);

    error NotMember();
    error AlreadyVoted();
    error BadChoice();
    error Closed();
    error Unauthorized();
    error Missing();
    error Empty();
    error TooLong();

    function createRoom(string calldata name) external returns (uint256 id) {
        if (bytes(name).length == 0) revert Empty();
        if (bytes(name).length > 80) revert TooLong();
        id = ++roomCount;
        rooms[id] = Room(msg.sender, uint64(block.timestamp));
        isMember[id][msg.sender] = true;
        emit RoomCreated(id, msg.sender, name);
        emit Joined(id, msg.sender);
    }

    function join(uint256 roomId) external {
        if (rooms[roomId].creator == address(0)) revert Missing();
        if (isMember[roomId][msg.sender]) return;
        isMember[roomId][msg.sender] = true;
        emit Joined(roomId, msg.sender);
    }

    function submitProposal(uint256 roomId, bytes32 thesisHash, string calldata data) external returns (uint256 id) {
        if (!isMember[roomId][msg.sender]) revert NotMember();
        if (bytes(data).length == 0) revert Empty();
        if (bytes(data).length > 4000) revert TooLong();
        id = ++proposalCount;
        proposals[id] = Proposal(roomId, msg.sender, false, false);
        emit ProposalSubmitted(id, roomId, msg.sender, thesisHash, data);
    }

    function castVote(uint256 proposalId, uint8 choice) external {
        Proposal storage p = proposals[proposalId];
        if (p.author == address(0)) revert Missing();
        if (p.closed) revert Closed();
        if (!isMember[p.roomId][msg.sender]) revert NotMember();
        if (choice < 1 || choice > 3) revert BadChoice();
        if (voteOf[proposalId][msg.sender] != 0) revert AlreadyVoted();
        voteOf[proposalId][msg.sender] = choice;
        emit Voted(proposalId, msg.sender, choice);
    }

    function closeVoting(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        if (p.author == address(0)) revert Missing();
        if (msg.sender != p.author && msg.sender != rooms[p.roomId].creator) revert Unauthorized();
        if (p.closed) revert Closed();
        p.closed = true;
        emit ProposalClosed(proposalId, msg.sender);
    }

    function recordOutcome(uint256 proposalId, string calldata data) external {
        Proposal storage p = proposals[proposalId];
        if (p.author == address(0)) revert Missing();
        if (msg.sender != p.author) revert Unauthorized();
        if (bytes(data).length == 0) revert Empty();
        if (bytes(data).length > 2000) revert TooLong();
        p.outcomeRecorded = true;
        emit OutcomeRecorded(proposalId, msg.sender, data);
    }
}
